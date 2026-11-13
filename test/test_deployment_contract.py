from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile
import unittest

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))

from deployment.contract_v21 import (
    ActiveRelease, ContractError, Schema, audit_event, authorize, check_answer,
    check_command_release, command_template_digest, digest, prepare_ask, read_json, validate_order,
)


DEPLOYMENT = BASE / "deployment"
BASES = {
    "order": read_json(DEPLOYMENT / "deployment-contract-v2.1.example.json"),
    **{name: read_json(DEPLOYMENT / "examples" / f"{name}.json")
       for name in ("manifest", "evidence", "ask-request", "ask-response")},
}
CASES = read_json(DEPLOYMENT / "deployment-contract-v2.1.cases.json")["cases"]
SCHEMA = Schema()
START = datetime(2026, 11, 12, 2, tzinfo=timezone.utc)
OPERATOR = "fixture-operator"
PROJECT = "fixture-multimodal"
MEMBERS = {(OPERATOR, PROJECT): {"operator"}, ("fixture-reviewer", PROJECT): {"reviewer"}}


def pointer_parts(path):
    return [part.replace("~1", "/").replace("~0", "~") for part in path.split("/")[1:]]


def walk(node, parts):
    for part in parts:
        node = node[int(part) if isinstance(node, list) else part]
    return node


def case_data(case):
    value = deepcopy(case["data"] if "data" in case else BASES[case["base"]])
    if "select" in case:
        value = walk(value, pointer_parts(case["select"]))
    for action, path, *args in case["edits"]:
        parts = pointer_parts(path)
        parent = walk(value, parts[:-1])
        key = int(parts[-1]) if isinstance(parent, list) else parts[-1]
        if action == "set":
            parent[key] = deepcopy(args[0])
        elif action == "remove":
            del parent[key]
        else:
            raise ValueError(action)
    return value


def seal_record(record):
    record.pop("recordHash", None)
    record["recordHash"] = digest(record)


def seal_order(order, manifest, evidence):
    order["manifestHash"] = digest(manifest)
    order["evidencePackHash"] = digest(evidence)
    return ActiveRelease(order["project"]["id"], order["revision"], order["manifestHash"],
                         order["versionLockId"], order["evidencePackHash"], digest(order))


def verified(lock):
    lock.update(status="verified", verifiedAt=START.isoformat(), verifiedBy="fixture-reviewer")
    lock["source"]["confidence"] = "verified"
    lock["verificationRefs"] = [deepcopy(lock["source"])]
    lock["compatibility"] = [{key: deepcopy(lock[key]) for key in
                              ("kubernetes", "sealos", "easyManager", "product", "chartIds", "imageIds")}]


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.order, self.manifest, self.evidence = [deepcopy(BASES[key]) for key in ("order", "manifest", "evidence")]

    def validation(self, now=START, release=None):
        return validate_order(SCHEMA, self.order, self.manifest, self.evidence, now=now, active_release=release)

    def seal(self):
        return seal_order(self.order, self.manifest, self.evidence)

    def rejects(self, code, fn):
        with self.assertRaises(ContractError) as raised:
            fn()
        self.assertEqual(raised.exception.code, code)

    def test_schema_cases(self):
        ids = set()
        for case in CASES:
            with self.subTest(case=case["id"]):
                self.assertNotIn(case["id"], ids)
                ids.add(case["id"])
                validator = SCHEMA.validator(case["definition"])
                errors = list(validator.iter_errors(case_data(case)))
                self.assertEqual(not errors, case["valid"], [error.message for error in errors])

    def test_rejects_duplicate_keys_before_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            document = Path(folder) / "duplicate.json"
            document.write_text('{"nested":{"revision":1,"revision":2}}', encoding="utf-8")
            self.rejects("DUPLICATE_JSON_KEY", lambda: read_json(document))

    def test_standalone_files_reproduce_order_and_evidence(self):
        self.assertIn("e-ingress", self.validation())
        self.evidence["records"][0]["redactedOutput"] = "changed"
        self.rejects("EVIDENCE_PACK_HASH_MISMATCH", self.validation)
        self.seal()
        self.rejects("EVIDENCE_RECORD_HASH_MISMATCH", self.validation)

    def test_expected_chart_cannot_be_hidden_by_empty_lock(self):
        self.manifest["versionLock"]["chartIds"] = []
        self.seal()
        self.rejects("MATERIAL_CHART_MISSING", self.validation)

    def test_second_chart_missing_despite_completed_upload(self):
        self.order["project"]["conditions"][0]["selected"] = True
        self.manifest["packageList"][0]["charts"].pop()
        self.seal()
        self.rejects("MATERIAL_CHART_MISSING", self.validation)

    def test_expected_image_must_be_in_locked_packages(self):
        self.manifest["packageList"][0]["images"].clear()
        self.seal()
        self.rejects("MATERIAL_IMAGE_MISSING", self.validation)

    def test_unselected_condition_must_be_resolved(self):
        self.order["project"]["conditions"][0]["selected"] = None
        self.seal()
        self.rejects("CONDITION_UNRESOLVED", self.validation)

    def test_test_and_production_require_a_verified_lock(self):
        for environment in ("test", "production"):
            with self.subTest(environment=environment):
                self.order["project"]["environment"] = environment
                self.rejects("VERSION_LOCK_UNVERIFIED", self.validation)
        verified(self.manifest["versionLock"])
        self.validation(release=self.seal())
        self.manifest["packageList"][0]["images"][0]["digest"] = None
        self.seal()
        self.rejects("IMAGE_DIGEST_MISSING", self.validation)

    def test_incompatible_version_tuple(self):
        verified(self.manifest["versionLock"])
        self.manifest["versionLock"]["compatibility"][0]["easyManager"] = "different-version"
        self.seal()
        self.rejects("VERSION_COMBINATION_MISMATCH", self.validation)

    def test_order_from_before_material_replacement(self):
        self.order["project"]["environment"] = "test"
        verified(self.manifest["versionLock"])
        old_release = self.seal()
        self.validation(release=old_release)
        old_order, old_manifest = deepcopy(self.order), deepcopy(self.manifest)
        self.manifest["packageList"][0]["sha256"] = "9" * 64
        self.rejects("MANIFEST_HASH_MISMATCH", lambda: self.validation(release=old_release))
        current_release = self.seal()
        self.validation(release=current_release)
        self.order, self.manifest = old_order, old_manifest
        self.rejects("ACTIVE_RELEASE_MISMATCH", lambda: self.validation(release=current_release))

    def test_evidence_must_match_step_revision_and_target(self):
        for field, value in (("inputHash", "d"*64), ("targetFingerprint", "e"*64), ("stepVersion", "old")):
            with self.subTest(field=field):
                self.evidence = deepcopy(BASES["evidence"])
                record = self.evidence["records"][0]
                record[field] = value
                seal_record(record)
                self.seal()
                self.rejects("EVIDENCE_SCOPE_MISMATCH", self.validation)
        self.evidence = deepcopy(BASES["evidence"])
        self.evidence["projectId"] = "another-project"
        self.seal()
        self.rejects("EVIDENCE_SCOPE_MISMATCH", self.validation)

    def test_equal_value_with_different_unit_cannot_pass(self):
        record = self.evidence["records"][0]
        record["facts"][0]["unit"] = "seconds"
        seal_record(record)
        self.seal()
        self.rejects("EVIDENCE_UNIT_MISMATCH", self.validation)

    def test_non_pass_evidence_cannot_satisfy_a_step(self):
        for result in ("stale", "invalid", "forbidden", "unknown"):
            with self.subTest(result=result):
                record = self.evidence["records"][0]
                record.update(result=result, reasonCode="unavailable")
                seal_record(record)
                self.seal()
                self.rejects("EVIDENCE_PASS_REQUIRED", self.validation)

    def test_new_failure_revokes_previous_pass(self):
        later = START + timedelta(minutes=1)
        record = deepcopy(self.evidence["records"][0])
        record.update(id="e-new-failure", result="fail", reasonCode="check-failed", observedAt=later.isoformat())
        seal_record(record)
        self.order["steps"][0]["evidenceIds"].append(record["id"])
        self.evidence["records"].append(record)
        self.seal()
        self.rejects("EVIDENCE_PASS_REVOKED", lambda: self.validation(now=later))

    def ready_gate(self):
        self.order["project"]["environment"] = "test"
        verified(self.manifest["versionLock"])
        step = self.order["steps"][-1]
        cmd = step["commands"][0]
        cmd["requiresCheckIds"] = []
        cmd["templateHash"] = command_template_digest(cmd)
        target = {"node": "node-a", "diskSerial": "fixture-disk"}
        inputs = {"path": "/data", "reuse": ["k8s"]}
        step.update(status="ready", targetFingerprint=digest(target), inputHash=digest(inputs))
        step["gate"] = {
            "targetFingerprint": step["targetFingerprint"], "inputHash": step["inputHash"],
            "approvalRef": "fixture-approval", "reviewerId": "fixture-reviewer",
            "backupRefs": ["fixture-backup"], "backupDecision": "required",
            "rollbackPointRef": "fixture-point", "rollbackId": cmd["rollbackId"],
            "approvedAt": START.isoformat(), "expiresAt": (START + timedelta(hours=1)).isoformat(),
        }
        return dict(now=START, active_release=self.seal(), instance_id=step["instanceId"], command_id=cmd["id"],
                    actor_id=OPERATOR, membership=MEMBERS, live_target=target, live_inputs=inputs,
                    trusted_templates={cmd["templateRef"]: cmd["templateHash"]}, approved_gate=deepcopy(step["gate"]))

    def release(self, options):
        return check_command_release(SCHEMA, self.order, self.manifest, self.evidence, **options)

    def test_gate_matches_live_target_inputs_and_approved_record(self):
        options = self.ready_gate()
        self.assertEqual(self.release(options), options["command_id"])
        for field, value in (("live_target", {"node": "node-b"}), ("live_inputs", {"path": "/data", "reuse": []})):
            with self.subTest(field=field):
                self.rejects("TARGET_OR_INPUT_CHANGED", lambda: self.release(options | {field: value}))
        self.rejects("GATE_NOT_APPROVED", lambda: self.release(options | {"approved_gate": None}))
        self.order["steps"][-1]["gate"]["inputHash"] = "c" * 64
        options.update(active_release=self.seal(), approved_gate=deepcopy(self.order["steps"][-1]["gate"]))
        self.rejects("GATE_SCOPE_CHANGED", lambda: self.release(options))

    def test_gate_expiry_window_and_template(self):
        options = self.ready_gate()
        self.rejects("GATE_EXPIRED", lambda: self.release(options | {"now": START + timedelta(hours=1)}))
        self.rejects("CHANGE_WINDOW_CLOSED", lambda: self.release(options | {"now": START + timedelta(hours=8)}))
        self.order["steps"][-1]["commands"][0]["instructionRef"] = "changed-procedure"
        options["active_release"] = self.seal()
        self.rejects("TEMPLATE_HASH_MISMATCH", lambda: self.release(options))

    def test_action_rechecks_dependency_evidence_ttl_at_release_time(self):
        options = self.ready_gate()
        self.order["steps"][-1]["dependsOnInstanceIds"] = [self.order["steps"][0]["instanceId"]]
        options["active_release"] = self.seal()
        self.assertEqual(self.release(options), options["command_id"])
        self.rejects("EVIDENCE_EXPIRED", lambda: self.release(options | {"now": START + timedelta(minutes=31)}))

    def test_suggested_parameter_never_releases_a_command(self):
        options = self.ready_gate()
        step = self.order["steps"][-1]
        step["params"] = [dict(self.order["steps"][0]["params"][0], status="suggested")]
        options["active_release"] = self.seal()
        self.rejects("PARAMETER_NOT_CONFIRMED", lambda: self.release(options))

    def accepted_handover(self):
        step = self.order["steps"][0]
        self.order["steps"] = [step]
        handover = self.order["handover"]
        handover.update(disposition="accepted", openIssues=[], observationStartedAt=START.isoformat(),
                        observation=[], acceptance={"customerRef": "fixture-customer", "signoffRef": "fixture-signoff",
                                                    "acceptedAt": (START + timedelta(hours=24)).isoformat()})
        for hours in (2, 24):
            at = (START + timedelta(hours=hours)).isoformat()
            record = dict(self.evidence["records"][0], id=f"e-observe-{hours}", observedAt=at)
            seal_record(record)
            self.evidence["records"].append(record)
            step["evidenceIds"].append(record["id"])
            step["updatedAt"] = at
            handover["observation"].append({
                "afterHours": hours, "dueAt": at, "ownerId": OPERATOR, "recheckIds": [record["checkId"]],
                "status": "passed", "evidenceIds": [record["id"]],
            })
        self.seal()
        return START + timedelta(hours=24)

    def test_handover_requires_distinct_observations_and_no_blocking_issue(self):
        now = self.accepted_handover()
        self.validation(now=now)
        handover = self.order["handover"]
        handover["openIssues"] = deepcopy(BASES["order"]["handover"]["openIssues"])
        self.rejects("HANDOVER_BLOCKING_ISSUE", lambda: self.validation(now=now))
        handover["openIssues"] = []
        handover["observation"][0]["evidenceIds"] = ["e-observe-24"]
        self.rejects("HANDOVER_OBSERVATION_OVERLAP", lambda: self.validation(now=now))
        handover["observation"][0]["evidenceIds"] = ["e-ingress"]
        self.rejects("HANDOVER_OBSERVATION_INVALID", lambda: self.validation(now=now))

    def test_project_role_checks_and_audit_schema(self):
        project = self.order["project"]
        for action in ("read", "modify", "import", "export", "ask"):
            with self.subTest(action=action):
                self.rejects("PROJECT_FORBIDDEN", lambda: authorize(project, OPERATOR, action, {
                    (OPERATOR, "other-project"): {"admin", "operator", "reviewer"},
                }))
        authorize(project, OPERATOR, "import", MEMBERS)
        authorize(project, "fixture-reviewer", "export", MEMBERS)
        self.rejects("PROJECT_FORBIDDEN", lambda: authorize(project, OPERATOR, "approve", MEMBERS))
        project["policy"]["exportAllowed"] = False
        self.rejects("EXPORT_FORBIDDEN", lambda: authorize(project, "fixture-reviewer", "export", MEMBERS))
        event = next(case["data"] for case in CASES if case["id"] == "metadata-only-audit")
        self.assertEqual(audit_event(SCHEMA, event), event)
        self.rejects("SCHEMA_INVALID", lambda: audit_event(SCHEMA, event | {"question": "content"}))

    def ask_setup(self):
        request = deepcopy(BASES["ask-request"])
        self.order["project"]["environment"] = "test"
        self.order["project"]["policy"].update(allowHermes=True, providerId="approved-provider", dataRegion="region-a",
                                               customerConsentRef="consent-1",
                                               consentUntil=(START + timedelta(hours=1)).isoformat())
        key = request["stepId"], request["stepVersion"]
        options = dict(actor_id=OPERATOR, membership=MEMBERS, now=START,
                       provider="approved-provider", data_region="region-a", consent_refs={"consent-1"},
                       step_catalog={key: request["symptomOptionIds"]}, sensitive_values=("internal.example.invalid",))
        return request, options

    def ask(self, request, options):
        return prepare_ask(SCHEMA, self.order["project"], request, **options)

    def test_outbound_rejects_sensitive_content_and_keeps_normal_error(self):
        request, options = self.ask_setup()
        self.assertEqual(self.ask(request, options), (request, None))
        for question in ("Why 192.0.2.10?", "Why fe80::1?", "Why internal.example.invalid?",
                         "token=demo-fixture", "token%3Ddemo-fixture", "dG9rZW49YWJjMTIz",
                         "-----BEGIN PRIVATE KEY-----\nfixture", "apiVersion: v1\nkind: ConfigMap",
                         "Traceback (most recent call last):\n  at service.fn(Foo.java:42)"):
            with self.subTest(question=question):
                self.assertEqual(self.ask(request | {"question": question}, options),
                                 (None, {"status": "rejected", "reason": "sensitive-content"}))
        self.assertEqual(self.ask(request | {"question": "Connection refused"}, options)[1], None)

    def test_outbound_rejection_states(self):
        request, options = self.ask_setup()
        for changes, reason in (({"consent_refs": set()}, "consent-required"),
                                ({"now": START + timedelta(hours=1)}, "consent-required"),
                                ({"data_region": "region-b"}, "provider-not-approved"),
                                ({"rate_limited": True}, "rate-limited"),
                                ({"membership": {}}, "project-forbidden")):
            with self.subTest(reason=reason):
                self.assertEqual(self.ask(request, options | changes),
                                 (None, {"status": "rejected", "reason": reason}))
        self.assertEqual(self.ask(request | {"stepVersion": "old"}, options)[1]["reason"], "step-version-mismatch")
        self.assertEqual(self.ask(request | {"yaml": "fixture"}, options)[1]["reason"], "invalid-request")
        self.order["project"]["environment"] = "fixture"
        self.assertEqual(self.ask(request, options)[1]["reason"], "offline")
        self.order["project"]["environment"] = "test"
        self.order["project"]["mode"] = "restricted"
        self.assertEqual(self.ask(request, options)[1]["reason"], "offline")

    def test_answer_citations_are_scoped_to_current_step_and_version(self):
        request = BASES["ask-request"]
        answer = deepcopy(BASES["ask-response"])
        sources = {(request["stepId"], request["stepVersion"]): {"deployment-review-d11"}}
        self.assertEqual(check_answer(SCHEMA, request, answer, sources), answer)
        for field, value in (("sourceId", "invented"), ("stepVersion", "old"), ("stepId", "other-step")):
            with self.subTest(field=field):
                changed = deepcopy(answer)
                changed["references"][0][field] = value
                self.assertEqual(check_answer(SCHEMA, request, changed, sources)["status"], "no-match")


if __name__ == "__main__":
    unittest.main()
