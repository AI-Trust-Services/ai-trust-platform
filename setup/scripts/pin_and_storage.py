#!/usr/bin/env python3
# pin_and_storage.py — inject nodeSelector / toleration / storageClassName into a
# multi-doc Kubernetes YAML file IN PLACE. Shared by the bash and PowerShell libs
# so the behaviour is identical on every OS. Requires pyyaml.
#
# Usage: pin_and_storage.py <file> <labelKey> <labelValue> <taint:true|false> <storageClass>
# Any of labelKey / storageClass may be empty ("") to skip that part.
import sys, yaml

def main():
    path, lk, lv, taint, sc = (sys.argv + ["", "", "", "false", ""])[1:6]
    with open(path) as f:
        docs = list(yaml.safe_load_all(f))
    for d in docs:
        if not d:
            continue
        kind = d.get("kind")
        if kind in ("Deployment", "StatefulSet", "Job") and lk:
            ps = d.setdefault("spec", {}).setdefault("template", {}).setdefault("spec", {})
            ps["nodeSelector"] = {lk: lv}
            if taint == "true":
                tols = ps.setdefault("tolerations", [])
                if not any(t.get("key") == lk for t in tols):
                    tols.append({"key": lk, "value": lv, "effect": "NoSchedule"})
        if sc:
            if kind == "PersistentVolumeClaim":
                d.setdefault("spec", {})["storageClassName"] = sc
            elif kind == "StatefulSet":
                for vct in d.get("spec", {}).get("volumeClaimTemplates", []) or []:
                    vct.setdefault("spec", {})["storageClassName"] = sc
    with open(path, "w") as f:
        yaml.safe_dump_all([d for d in docs if d], f, default_flow_style=False, sort_keys=False)

if __name__ == "__main__":
    main()
