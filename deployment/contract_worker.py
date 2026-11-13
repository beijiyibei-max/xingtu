"""One request per process; stdin and stdout carry bounded local JSON only."""
from datetime import datetime, timezone
import json
import sys
from contract_v21 import Schema, ActiveRelease, ContractError, _unique_pairs, _reject_constant, digest, validate_order

try:
    body = json.loads(sys.stdin.buffer.read(524289).decode("utf-8"),
                      object_pairs_hook=_unique_pairs, parse_constant=_reject_constant)
    if set(body) != {"order", "manifest", "evidence"}:
        raise ContractError("INVALID_FIELDS")
    order, manifest, evidence = (body[name] for name in ("order", "manifest", "evidence"))
    # This endpoint checks an imported package. It does not approve a live release.
    schema = Schema()
    schema.check(order, "order")
    release = ActiveRelease(order["project"]["id"], order["revision"], order["manifestHash"],
                            order["versionLockId"], order["evidencePackHash"], digest(order))
    validate_order(schema, order, manifest, evidence, now=datetime.now(timezone.utc), active_release=release)
    result = {"valid": True, "executionApproved": False, "fixture": order["project"]["environment"] == "fixture",
              "projectId": order["project"]["id"], "revision": order["revision"],
              "steps": [{"id": step["instanceId"], "stepId": step["stepId"], "status": step["status"],
                         "risk": step["risk"], "target": [cmd["target"]["ref"] for cmd in step["commands"]],
                         "reason": step.get("reasonCode", "")} for step in order["steps"]]}
except ContractError as error:
    result = {"valid": False, "code": error.code}
except Exception:
    result = {"valid": False, "code": "INVALID_PACKAGE"}
sys.stdout.write(json.dumps(result, ensure_ascii=True))
