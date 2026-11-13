"""Offline contract checks. Callers supply authenticated, current server state."""

import base64
import binascii
from dataclasses import dataclass
from datetime import datetime, timedelta
from hashlib import sha256
import ipaddress
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import unquote

from jsonschema import Draft202012Validator, FormatChecker
import rfc8785


class ContractError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def require(condition, code):
    if not condition:
        raise ContractError(code)


def _unique_pairs(pairs):
    result = {}
    for name, value in pairs:
        require(name not in result, "DUPLICATE_JSON_KEY")
        result[name] = value
    return result


def _reject_constant(_):
    raise ContractError("INVALID_JSON_NUMBER")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"),
                      object_pairs_hook=_unique_pairs, parse_constant=_reject_constant)


def digest(value):
    try:
        return sha256(rfc8785.dumps(value)).hexdigest()
    except rfc8785.CanonicalizationError:
        raise ContractError("INVALID_CANONICAL_JSON") from None


def instant(value):
    return datetime.fromisoformat(value.upper().replace("Z", "+00:00"))


def index(items, key):
    result = {}
    for item in items:
        name = item[key]
        require(name not in result, "DUPLICATE_ID")
        result[name] = item
    return result


class Schema:
    def __init__(self):
        path = Path(__file__).with_name("deployment-contract-v2.1.schema.json")
        self.document = read_json(path)
        Draft202012Validator.check_schema(self.document)
        formats = FormatChecker()
        require("date-time" in formats.checkers, "DATE_TIME_CHECKER_MISSING")
        self.root = Draft202012Validator(self.document, format_checker=formats)

    def validator(self, definition=None):
        if definition is None:
            return self.root
        if definition not in self.document["$defs"]:
            raise KeyError(definition)
        return self.root.evolve(schema={
            "$schema": self.document["$schema"],
            "$defs": self.document["$defs"],
            "$ref": f"#/$defs/{definition}",
        })

    def check(self, data, definition=None):
        require(self.validator(definition).is_valid(data), "SCHEMA_INVALID")


@dataclass(frozen=True)
class ActiveRelease:
    project_id: str
    revision: int
    manifest_hash: str
    version_lock_id: str
    evidence_pack_hash: str
    order_hash: str


def _expected_materials(order):
    conditions = index(order["project"]["conditions"], "id")
    charts, images = set(), set()
    for component in index(order["components"], "id").values():
        if component["scope"] == "conditional":
            selection = conditions.get(component["conditionId"], {}).get("selected")
            require(selection is not None, "CONDITION_UNRESOLVED")
            if not selection:
                continue
        elif component["scope"] != "required":
            continue
        if component["providedBy"] == "chart":
            charts.add(component["chartId"])
        if component["providedBy"] in {"chart", "image-only"}:
            images.update(component["imageIds"])
    return charts, images


def _validate_materials(order, manifest):
    lock = manifest["versionLock"]
    packages = index(manifest["packageList"], "id")
    require(set(lock["packageIds"]) <= packages.keys(), "MATERIAL_PACKAGE_MISSING")
    locked_packages = [packages[key] for key in lock["packageIds"]]
    charts = index((chart for pkg in locked_packages for chart in pkg["charts"]), "id")
    images = index((image for pkg in locked_packages for image in pkg["images"]), "id")
    chart_ids, image_ids = _expected_materials(order)
    require(chart_ids <= set(lock["chartIds"]) <= charts.keys(), "MATERIAL_CHART_MISSING")
    require(image_ids <= set(lock["imageIds"]) <= images.keys(), "MATERIAL_IMAGE_MISSING")
    if order["project"]["environment"] != "fixture":
        require(lock["status"] == "verified", "VERSION_LOCK_UNVERIFIED")
        require(all(images[key]["digest"] is not None for key in image_ids), "IMAGE_DIGEST_MISSING")
    if lock["status"] == "verified":
        versions = ("kubernetes", "sealos", "easyManager", "product")
        require(any(
            all(combo[key] == lock[key] for key in versions)
            and all(set(combo[key]) == set(lock[key]) for key in ("chartIds", "imageIds"))
            for combo in lock["compatibility"]
        ), "VERSION_COMBINATION_MISMATCH")


def _check_facts(check, record):
    facts = index(record["facts"], "name")
    for expectation in check["expectations"]:
        fact = facts.get(expectation["fact"])
        require(fact is not None, "EVIDENCE_FIELD_MISSING")
        actual, expected = fact["value"], expectation["value"]
        require(type(actual) is type(expected), "EVIDENCE_TYPE_MISMATCH")
        require(fact.get("unit") == expectation.get("unit"), "EVIDENCE_UNIT_MISMATCH")
        operator = expectation["operator"]
        if operator == "eq":
            match = actual == expected
        elif operator == "gte":
            match = actual >= expected
        elif operator == "lte":
            match = actual <= expected
        elif operator == "contains-all":
            match = set(expected) <= set(actual)
        else:
            match = set(actual) == set(expected)
        require(match, "EVIDENCE_CRITERION_FAILED")


def _validate_records(order, evidence, now):
    steps = index(order["steps"], "instanceId")
    records = index(evidence["records"], "id")
    for step in steps.values():
        require(step["projectId"] == order["project"]["id"]
                and step["planRevision"] == order["revision"], "STEP_SCOPE_MISMATCH")
        require(set(step["evidenceIds"]) <= records.keys(), "EVIDENCE_MISSING")
        require(all(records[key]["instanceId"] == step["instanceId"] for key in step["evidenceIds"]),
                "EVIDENCE_SCOPE_MISMATCH")
        risk_rank = {"normal": 0, "destructive": 1, "data-loss": 2}
        require(all(risk_rank[command["risk"]] <= risk_rank[step["risk"]] for command in step["commands"]),
                "STEP_RISK_UNDERSTATED")

    checks_by_step = {key: index(step["checks"], "id") for key, step in steps.items()}
    for record in records.values():
        step = steps.get(record["instanceId"])
        require(step is not None and record["id"] in step["evidenceIds"], "EVIDENCE_SCOPE_MISMATCH")
        require(all(record[key] == step[key] for key in
                    ("stepId", "stepVersion", "targetFingerprint", "inputHash")), "EVIDENCE_SCOPE_MISMATCH")
        require(instant(record["observedAt"]) <= now, "EVIDENCE_FROM_FUTURE")
        require(digest({key: value for key, value in record.items() if key != "recordHash"})
                == record["recordHash"], "EVIDENCE_RECORD_HASH_MISMATCH")
        check = checks_by_step[step["instanceId"]].get(record["checkId"])
        require(check is not None and record["evidenceType"] in check["evidenceTypes"],
                "EVIDENCE_CHECK_MISMATCH")
        if check["kind"] == "probe":
            require(record.get("commandId") == check["commandId"], "EVIDENCE_CHECK_MISMATCH")
        if record["result"] == "pass":
            _check_facts(check, record)

    for step in steps.values():
        if step["status"] == "passed":
            assessed_at = instant(step["updatedAt"])
            require(assessed_at <= now, "STEP_FROM_FUTURE")
            for check in step["checks"]:
                if check["required"]:
                    step_records = [records[key] for key in step["evidenceIds"]]
                    _require_fresh_pass(check, step_records, assessed_at)
                    require(not any(record["checkId"] == check["id"] and record["result"] != "pass"
                                    and instant(record["observedAt"]) > assessed_at for record in step_records),
                            "EVIDENCE_PASS_REVOKED")
    return records


def _require_fresh_pass(check, records, at):
    candidates = [record for record in records if record["checkId"] == check["id"]
                  and instant(record["observedAt"]) <= at]
    require(candidates, "EVIDENCE_PASS_REQUIRED")
    latest = max(instant(record["observedAt"]) for record in candidates)
    require(latest + timedelta(seconds=check["ttlSeconds"]) >= at, "EVIDENCE_EXPIRED")
    require(all(record["result"] == "pass" for record in candidates
                if instant(record["observedAt"]) == latest), "EVIDENCE_PASS_REQUIRED")


def _validate_handover(order, records, now):
    handover = order.get("handover")
    if handover is None:
        return
    require((handover["projectId"], handover["planRevision"], handover["versionLockId"]) ==
            (order["project"]["id"], order["revision"], order["versionLockId"]), "HANDOVER_SCOPE_MISMATCH")
    passed = {step["instanceId"] for step in order["steps"] if step["status"] == "passed"}
    require(set(handover["completedInstanceIds"]) <= passed, "HANDOVER_STEP_UNVERIFIED")
    observations = index(handover["observation"], "afterHours")
    for observation in observations.values():
        if observation["status"] == "passed":
            observed = [records.get(key) for key in observation["evidenceIds"]]
            require(all(record and record["result"] == "pass" and
                        instant(record["observedAt"]) >= instant(observation["dueAt"])
                        for record in observed), "HANDOVER_OBSERVATION_INVALID")
            require(set(observation["recheckIds"]) <= {record["checkId"] for record in observed},
                    "HANDOVER_OBSERVATION_INCOMPLETE")
    if handover["disposition"] == "accepted":
        require(not any(issue["blocking"] for issue in handover["openIssues"]), "HANDOVER_BLOCKING_ISSUE")
        require(all(step["status"] in {"passed", "skipped"} for step in order["steps"])
                and set(handover["completedInstanceIds"]) == passed, "HANDOVER_STEP_UNVERIFIED")
        anchor = instant(handover["observationStartedAt"])
        for hours, observation in observations.items():
            require(instant(observation["dueAt"]) == anchor + timedelta(hours=hours),
                    "HANDOVER_OBSERVATION_SCHEDULE")
        early = observations[2]["evidenceIds"]
        late = observations[24]["evidenceIds"]
        require(max(instant(records[key]["observedAt"]) for key in early)
                < min(instant(records[key]["observedAt"]) for key in late), "HANDOVER_OBSERVATION_OVERLAP")
        accepted = instant(handover["acceptance"]["acceptedAt"])
        require(accepted <= now and all(
            instant(records[key]["observedAt"]) <= accepted
            for observation in observations.values() for key in observation["evidenceIds"]
        ), "HANDOVER_SIGNOFF_TIME_INVALID")


def validate_order(schema, order, manifest, evidence, *, now, active_release=None):
    schema.check(order, "order")
    schema.check(manifest, "materialManifest")
    schema.check(evidence, "evidencePack")
    project = order["project"]
    require((project["manifestId"], order["versionLockId"]) ==
            (manifest["id"], manifest["versionLock"]["id"]), "MANIFEST_SCOPE_MISMATCH")
    require(order["manifestHash"] == digest(manifest), "MANIFEST_HASH_MISMATCH")
    require((order["evidencePackId"], project["id"], order["revision"], order["versionLockId"]) ==
            (evidence["id"], evidence["projectId"], evidence["planRevision"], evidence["versionLockId"]),
            "EVIDENCE_SCOPE_MISMATCH")
    require(order["evidencePackHash"] == digest(evidence), "EVIDENCE_PACK_HASH_MISMATCH")
    _validate_materials(order, manifest)
    if project["environment"] != "fixture":
        expected = ActiveRelease(project["id"], order["revision"], order["manifestHash"],
                                 order["versionLockId"], order["evidencePackHash"], digest(order))
        require(active_release == expected, "ACTIVE_RELEASE_MISMATCH")
    records = _validate_records(order, evidence, now)
    _validate_handover(order, records, now)
    return records


_ROLES = {
    "read": {"operator", "reviewer", "admin"},
    "modify": {"operator"},
    "import": {"operator"},
    "export": {"reviewer"},
    "ask": {"operator", "reviewer"},
    "review": {"reviewer"},
    "approve": {"reviewer"},
    "rollback": {"operator"},
    "sign-off": {"reviewer"},
}


def authorize(project, actor_id, action, membership):
    """membership maps (authenticated actor, project) to roles from the server."""
    roles = membership.get((actor_id, project["id"]), ())
    require(not _ROLES.get(action, set()).isdisjoint(roles), "PROJECT_FORBIDDEN")
    policy = project["policy"]
    if action == "import":
        require(policy["allowResultImport"], "IMPORT_FORBIDDEN")
    if action == "export":
        require(policy["exportAllowed"], "EXPORT_FORBIDDEN")


def command_template_digest(command):
    fields = ("kind", "argv", "instructionRef", "risk", "timeoutSeconds", "idempotency",
              "retry", "credentialMode", "rollbackId")
    template = {key: command[key] for key in fields if key in command}
    template["target"] = {key: command["target"][key] for key in ("role", "shell") if key in command["target"]}
    return digest(template)


def check_command_release(schema, order, manifest, evidence, *, now, active_release, instance_id, command_id,
                          actor_id, membership, live_target, live_inputs, trusted_templates, approved_gate=None):
    project = order["project"]
    authorize(project, actor_id, "modify", membership)
    require(project["environment"] != "fixture", "FIXTURE_EXECUTION_FORBIDDEN")
    records = validate_order(schema, order, manifest, evidence, now=now, active_release=active_release)
    steps = index(order["steps"], "instanceId")
    step = steps.get(instance_id)
    require(step is not None and step["status"] == "ready", "STEP_NOT_READY")
    command = index(step["commands"], "id").get(command_id)
    require(command is not None, "COMMAND_NOT_FOUND")
    require(all(param["status"] == "confirmed" for param in step["params"]), "PARAMETER_NOT_CONFIRMED")
    require(trusted_templates.get(command["templateRef"]) == command["templateHash"] == command_template_digest(command),
            "TEMPLATE_HASH_MISMATCH")
    target_hash, input_hash = digest(live_target), digest(live_inputs)
    require((target_hash, input_hash) == (step["targetFingerprint"], step["inputHash"]), "TARGET_OR_INPUT_CHANGED")
    all_checks = index((check for item in order["steps"] for check in item["checks"]), "id")
    for predecessor in step["dependsOnInstanceIds"]:
        dependency = steps.get(predecessor)
        require(dependency is not None and dependency["status"] == "passed", "PREREQUISITE_NOT_PASSED")
        for check in dependency["checks"]:
            if check["required"]:
                _require_fresh_pass(check, [records[key] for key in dependency["evidenceIds"]], now)
    for key in command["requiresCheckIds"]:
        require(key in all_checks, "PREREQUISITE_NOT_FOUND")
        _require_fresh_pass(all_checks[key], records.values(), now)
    if step["risk"] != "normal" or command["risk"] != "normal":
        gate = step.get("gate")
        require(gate is not None and gate == approved_gate, "GATE_NOT_APPROVED")
        require((gate["targetFingerprint"], gate["inputHash"]) == (target_hash, input_hash), "GATE_SCOPE_CHANGED")
        require(gate["reviewerId"] != actor_id, "GATE_REVIEWER_CONFLICT")
        require(command.get("rollbackId", gate["rollbackId"]) == gate["rollbackId"]
                and gate["rollbackId"] in index(order["rollbackPlans"], "id"), "GATE_ROLLBACK_MISMATCH")
        window = project["changeWindow"]
        require(instant(window["startsAt"]) <= now < instant(window["endsAt"]), "CHANGE_WINDOW_CLOSED")
        require(instant(gate["approvedAt"]) <= now < instant(gate["expiresAt"]), "GATE_EXPIRED")
    return command["id"]


_SENSITIVE = re.compile(
    r"-----BEGIN [^-\n]+-----|(?:[0-9]{1,3}\.){3}[0-9]{1,3}"
    r"|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}"
    r"|(?:password|passwd|token|authorization|secret|api[_-]?key|access[_-]?key|client[_-]?key)"
    r"""["']?\s*[:=]\s*\S|\bBearer\s+[\w./+=-]+"""
    r"|https?://[^\s/]+@|(?:https?|ssh|jdbc):[/a-z]"
    r"|(?m:^[ \t]*(?:[-*] )?[\w.-]+:\s+\S|^\s*at\s+[\w.$]+\(|^\s*Traceback\s*\()",
    re.IGNORECASE,
)


def _question_forms(text):
    current = unicodedata.normalize("NFKC", text)
    for _ in range(3):
        yield current
        current = unquote(current)
    for token in re.findall(r"(?<![\w+/=-])[A-Za-z0-9+/_-]{12,}={0,2}(?![\w+/=-])", current):
        try:
            yield base64.b64decode(token + "=" * (-len(token) % 4), altchars=b"-_", validate=True).decode()
        except (UnicodeError, binascii.Error):
            continue


def _sensitive_question(text, known_values):
    for form in _question_forms(text):
        if _SENSITIVE.search(form) or any(value and value.casefold() in form.casefold() for value in known_values):
            return True
        for candidate in re.findall(r"(?<!\w)[a-fA-F0-9:]{2,}(?!\w)", form):
            if ":" in candidate:
                try:
                    if ipaddress.ip_address(candidate).version == 6:
                        return True
                except ValueError:
                    continue
    return False


def prepare_ask(schema, project, request, *, actor_id, membership, now, provider, data_region,
                consent_refs, step_catalog, sensitive_values=(), rate_limited=False):
    """Return (approved outbound fields, local rejection). No network call is made."""
    try:
        authorize(project, actor_id, "ask", membership)
    except ContractError:
        return None, {"status": "rejected", "reason": "project-forbidden"}
    policy = project["policy"]
    if project["mode"] == "restricted" or project["environment"] == "fixture" or not policy["allowHermes"]:
        return None, {"status": "rejected", "reason": "offline"}
    if not schema.validator("askRequest").is_valid(request):
        return None, {"status": "rejected", "reason": "invalid-request"}
    if (provider, data_region) != (policy["providerId"], policy["dataRegion"]):
        return None, {"status": "rejected", "reason": "provider-not-approved"}
    if policy["customerConsentRef"] not in consent_refs or now >= instant(policy["consentUntil"]):
        return None, {"status": "rejected", "reason": "consent-required"}
    key = request["stepId"], request["stepVersion"]
    if key not in step_catalog or not set(request["symptomOptionIds"]) <= set(step_catalog[key]):
        return None, {"status": "rejected", "reason": "step-version-mismatch"}
    if rate_limited:
        return None, {"status": "rejected", "reason": "rate-limited"}
    if _sensitive_question(request["question"], tuple(sensitive_values)):
        return None, {"status": "rejected", "reason": "sensitive-content"}
    return {name: request[name] for name in ("question", "stepId", "stepVersion", "symptomOptionIds")}, None


def check_answer(schema, request, response, shared_sources):
    """shared_sources maps (step ID, step version) to approved source IDs."""
    no_match = {"status": "no-match", "reason": "unverified-source"}
    if not schema.validator("askResponse").is_valid(response):
        return no_match
    if response["status"] == "no-match":
        return response
    if response["status"] != "answered":
        return no_match
    key = request["stepId"], request["stepVersion"]
    allowed = shared_sources.get(key, ())
    if any((reference["stepId"], reference["stepVersion"]) != key or reference["sourceId"] not in allowed
           for reference in response["references"]):
        return no_match
    return response


def audit_event(schema, event):
    schema.check(event, "auditEvent")
    return dict(event)
