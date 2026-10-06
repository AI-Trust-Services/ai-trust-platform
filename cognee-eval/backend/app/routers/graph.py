import json
import os

import ladybug
from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse

from app import cognee_client

router = APIRouter(prefix="/graph", tags=["graph"])

_KUZU_PATH = os.path.join(
    os.environ.get("COGNEE_DATA_PATH", "/app/.cognee_system"),
    "system",
    "databases",
    "cognee_graph_kuzu",
)


@router.get("/stats")
async def graph_stats() -> dict:
    """Return a high-level summary of the knowledge graph structure.

    Shows entity types, relationship types, and counts extracted from
    the EU AI Act. Use this to assess ingestion quality before running
    evaluations.
    """
    return await cognee_client.get_graph_stats()


@router.get("/entities")
async def list_entities(
    type: str | None = Query(None, description="Filter by entity type e.g. Article, Obligation"),
    limit: int = Query(50, le=200),
) -> list[dict]:
    """List entities extracted from the EU AI Act knowledge graph.

    Filter by type to inspect specific entity classes (Article, Recital,
    Annex, Definition, Obligation...). Limit defaults to 50, max 200.
    """
    return await cognee_client.search_entities(entity_type=type, limit=limit)


@router.get("/raw")
def graph_raw() -> dict:
    """Return all nodes and edges directly from the Kuzu graph database."""
    db = ladybug.Database(_KUZU_PATH, read_only=True)
    conn = ladybug.Connection(db)
    try:
        nodes = []
        r = conn.execute("MATCH (n:Node) RETURN n.id, n.name, n.type")
        while r.has_next():
            row = r.get_next()
            nodes.append({"id": row[0], "name": row[1], "type": row[2]})

        edges = []
        r = conn.execute("MATCH (a:Node)-[e:EDGE]->(b:Node) RETURN a.id, e.relationship_name, b.id")
        while r.has_next():
            row = r.get_next()
            edges.append({"from": row[0], "label": row[1], "to": row[2]})
    finally:
        conn.close()
        db.close()

    return {"nodes": nodes, "edges": edges}


@router.get("/viz", response_class=HTMLResponse)
def graph_viz() -> HTMLResponse:
    """Interactive graph visualization using vis-network."""
    data = graph_raw()
    nodes_json = json.dumps([
        {"id": n["id"], "label": n["name"], "group": n["type"], "title": n["type"]}
        for n in data["nodes"] if n["id"]
    ])
    edges_json = json.dumps([
        {"from": e["from"], "to": e["to"], "label": e["label"]}
        for e in data["edges"] if e["from"] and e["to"]
    ])
    html = f"""<!DOCTYPE html>
<html>
<head>
  <title>Cognee Knowledge Graph</title>
  <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
  <style>
    body {{ margin: 0; background: #1a1a2e; color: #eee; font-family: sans-serif; }}
    #graph {{ width: 100vw; height: 100vh; }}
    #legend {{ position: fixed; top: 10px; left: 10px; background: rgba(0,0,0,.6); padding: 10px; border-radius: 6px; font-size: 13px; }}
  </style>
</head>
<body>
  <div id="graph"></div>
  <div id="legend"><b>Knowledge Graph</b><br>{len(data["nodes"])} nodes · {len(data["edges"])} edges</div>
  <script>
    const nodes = new vis.DataSet({nodes_json});
    const edges = new vis.DataSet({edges_json});
    new vis.Network(document.getElementById("graph"), {{nodes, edges}}, {{
      nodes: {{ shape: "dot", size: 14, font: {{ color: "#eee", size: 13 }} }},
      edges: {{ arrows: "to", font: {{ color: "#aaa", size: 11, align: "middle" }}, color: {{ color: "#555" }} }},
      physics: {{ stabilization: {{ iterations: 200 }} }},
      groups: {{
        Entity: {{ color: {{ background: "#4e8ef7" }} }},
        EntityType: {{ color: {{ background: "#f7a04e" }} }},
        DocumentChunk: {{ color: {{ background: "#555", border: "#888" }} }},
        TextDocument: {{ color: {{ background: "#6fcf97" }} }},
        TextSummary: {{ color: {{ background: "#bb86fc" }} }},
      }}
    }});
  </script>
</body>
</html>"""
    return HTMLResponse(html)

