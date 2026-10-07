"""Normalize spreadsheet XML for readers that require unprefixed element names."""

import os
import posixpath
from pathlib import Path
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
ET.register_namespace("", MAIN)
ET.register_namespace("r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")


def normalize(path: Path) -> None:
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, suffix=".xlsx", delete=False) as file:
            temporary = Path(file.name)
        with zipfile.ZipFile(path) as source, zipfile.ZipFile(temporary, "w") as target:
            for entry in source.infolist():
                content = source.read(entry)
                if entry.filename.endswith((".xml", ".rels")):
                    root = ET.fromstring(content)
                    if root.tag.startswith("{" + MAIN + "}"):
                        ET.register_namespace("", MAIN)
                        content = ET.tostring(root, encoding="utf-8", xml_declaration=True)
                    elif root.tag == "{" + REL + "}Relationships":
                        owner_dir = posixpath.dirname(posixpath.dirname(entry.filename))
                        for relationship in root:
                            target_path = relationship.get("Target", "")
                            if target_path.startswith("/") and relationship.get("TargetMode") != "External":
                                relationship.set("Target", posixpath.relpath(target_path.lstrip("/"), owner_dir or "."))
                        ET.register_namespace("", REL)
                        content = ET.tostring(root, encoding="utf-8", xml_declaration=True)
                target.writestr(entry, content)
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


if __name__ == "__main__":
    normalize(Path(sys.argv[1]))
