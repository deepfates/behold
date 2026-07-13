#!/usr/bin/env python3
"""Stream an OSM PBF into the small Overpass-JSON subset consumed by Arnis."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, TextIO

import osmium


class OverpassWriter(osmium.SimpleHandler):
    def __init__(self, destination: TextIO) -> None:
        super().__init__()
        self.destination = destination
        self.first = True
        self.counts = {"node": 0, "way": 0, "relation": 0}
        destination.write('{"version":0.6,"generator":"behold-pbf-to-overpass","elements":[')

    def emit(self, element: dict[str, Any]) -> None:
        if not self.first:
            self.destination.write(",")
        self.first = False
        json.dump(element, self.destination, ensure_ascii=False, separators=(",", ":"))
        self.counts[element["type"]] += 1

    def node(self, node: osmium.osm.Node) -> None:
        if not node.visible or not node.location.valid():
            return
        element: dict[str, Any] = {
            "type": "node",
            "id": node.id,
            "lat": node.location.lat,
            "lon": node.location.lon,
        }
        if len(node.tags):
            element["tags"] = dict(node.tags)
        self.emit(element)

    def way(self, way: osmium.osm.Way) -> None:
        if not way.visible:
            return
        element: dict[str, Any] = {
            "type": "way",
            "id": way.id,
            "nodes": [node.ref for node in way.nodes],
        }
        if len(way.tags):
            element["tags"] = dict(way.tags)
        self.emit(element)

    def relation(self, relation: osmium.osm.Relation) -> None:
        if not relation.visible:
            return
        element: dict[str, Any] = {
            "type": "relation",
            "id": relation.id,
            "members": [
                {
                    "type": {"n": "node", "w": "way", "r": "relation"}.get(
                        str(member.type), str(member.type)
                    ),
                    "ref": member.ref,
                    "role": member.role,
                }
                for member in relation.members
            ],
        }
        if len(relation.tags):
            element["tags"] = dict(relation.tags)
        self.emit(element)

    def close(self) -> None:
        self.destination.write("]}\n")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Input .osm.pbf file")
    parser.add_argument("output", type=Path, help="Output Overpass-compatible JSON file")
    return parser.parse_args()


def main() -> None:
    arguments = parse_arguments()
    if arguments.output.exists():
        raise FileExistsError(f"Refusing to overwrite {arguments.output}")
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    with arguments.output.open("x", encoding="utf-8") as destination:
        writer = OverpassWriter(destination)
        try:
            writer.apply_file(str(arguments.input), locations=False)
            writer.close()
        except BaseException:
            arguments.output.unlink(missing_ok=True)
            raise
    print(json.dumps({"input": str(arguments.input), "output": str(arguments.output), **writer.counts}))


if __name__ == "__main__":
    main()
