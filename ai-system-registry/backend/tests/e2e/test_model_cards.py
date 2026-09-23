"""E2E tests for Model Card API — in-process via ASGITransport against ai_trust_test DB."""
from __future__ import annotations

import httpx
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _create_card(client: httpx.AsyncClient, payload: dict | None = None) -> dict:
    payload = payload or {"name": "Test Model"}
    r = await client.post("/v1/model-cards", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


async def _create_dataset(client: httpx.AsyncClient, card_id: str, payload: dict | None = None) -> dict:
    payload = payload or {"name": "Test Dataset", "type": "train"}
    r = await client.post(f"/v1/model-cards/{card_id}/datasets", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------------------
# POST /model-cards
# ---------------------------------------------------------------------------

async def test_create_model_card_minimal(client: httpx.AsyncClient):
    r = await client.post("/v1/model-cards", json={"name": "Cancer Classifier"})
    assert r.status_code == 201
    body = r.json()
    assert body["id"].startswith("MDL-")
    assert body["name"] == "Cancer Classifier"
    assert body["version"] is None
    assert body["tags"] == []
    assert body["metrics"] == []
    assert body["sources"] == []
    assert body["datasets"] == []
    assert "created_at" in body
    assert "updated_at" in body


async def test_create_model_card_with_scalars(client: httpx.AsyncClient):
    payload = {
        "name": "Speech Model",
        "version": "2.0",
        "base_model": "whisper-large",
        "library_name": "transformers",
        "license": "apache-2.0",
        "training_commit": "abc123",
        "validation_status": "deployed",
        "task_type": "automatic-speech-recognition",
        "task_name": "Speech Recognition",
        "tags": ["audio", "en"],
    }
    r = await client.post("/v1/model-cards", json=payload)
    assert r.status_code == 201
    body = r.json()
    assert body["version"] == "2.0"
    assert body["base_model"] == "whisper-large"
    assert body["task_type"] == "automatic-speech-recognition"
    assert body["tags"] == ["audio", "en"]


async def test_create_model_card_requires_name(client: httpx.AsyncClient):
    r = await client.post("/v1/model-cards", json={})
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# GET /model-cards
# ---------------------------------------------------------------------------

async def test_list_model_cards(client: httpx.AsyncClient):
    await _create_card(client, {"name": "Model A"})
    await _create_card(client, {"name": "Model B"})
    r = await client.get("/v1/model-cards")
    assert r.status_code == 200
    names = [c["name"] for c in r.json()]
    assert "Model A" in names
    assert "Model B" in names


async def test_list_model_cards_empty(client: httpx.AsyncClient):
    r = await client.get("/v1/model-cards")
    assert r.status_code == 200
    assert r.json() == []


# ---------------------------------------------------------------------------
# GET /model-cards/{id}
# ---------------------------------------------------------------------------

async def test_get_model_card_returns_full_tree(client: httpx.AsyncClient):
    card = await _create_card(client)
    r = await client.get(f"/v1/model-cards/{card['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == card["id"]
    assert body["metrics"] == []
    assert body["sources"] == []
    assert body["datasets"] == []


async def test_get_model_card_not_found(client: httpx.AsyncClient):
    r = await client.get("/v1/model-cards/MDL-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PATCH /model-cards/{id}
# ---------------------------------------------------------------------------

async def test_patch_model_card_scalars(client: httpx.AsyncClient):
    card = await _create_card(client, {"name": "Old Name"})
    r = await client.patch(f"/v1/model-cards/{card['id']}", json={"name": "New Name", "version": "3.0"})
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "New Name"
    assert body["version"] == "3.0"


async def test_patch_model_card_partial(client: httpx.AsyncClient):
    card = await _create_card(client, {"name": "My Model", "version": "1.0"})
    r = await client.patch(f"/v1/model-cards/{card['id']}", json={"version": "2.0"})
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "My Model"    # unchanged
    assert body["version"] == "2.0"      # updated


async def test_patch_model_card_not_found(client: httpx.AsyncClient):
    r = await client.patch("/v1/model-cards/MDL-NOTFOUND", json={"name": "X"})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /model-cards/{id}
# ---------------------------------------------------------------------------

async def test_delete_model_card(client: httpx.AsyncClient):
    card = await _create_card(client)
    r = await client.delete(f"/v1/model-cards/{card['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == card["id"]
    # gone
    r2 = await client.get(f"/v1/model-cards/{card['id']}")
    assert r2.status_code == 404


async def test_delete_model_card_not_found(client: httpx.AsyncClient):
    r = await client.delete("/v1/model-cards/MDL-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# POST /model-cards/{id}/metrics  +  DELETE /model-cards/{id}/metrics/{mid}
# ---------------------------------------------------------------------------

async def test_add_metric(client: httpx.AsyncClient):
    card = await _create_card(client)
    r = await client.post(f"/v1/model-cards/{card['id']}/metrics", json={"value": 0.94, "name": "Accuracy"})
    assert r.status_code == 201
    body = r.json()
    assert body["id"].startswith("MCM-")
    assert body["value"] == 0.94
    assert body["name"] == "Accuracy"


async def test_metric_appears_in_tree(client: httpx.AsyncClient):
    card = await _create_card(client)
    await client.post(f"/v1/model-cards/{card['id']}/metrics", json={"value": 0.91, "name": "F1"})
    tree = (await client.get(f"/v1/model-cards/{card['id']}")).json()
    assert len(tree["metrics"]) == 1
    assert tree["metrics"][0]["name"] == "F1"


async def test_delete_metric(client: httpx.AsyncClient):
    card = await _create_card(client)
    metric = (await client.post(
        f"/v1/model-cards/{card['id']}/metrics", json={"value": 0.9, "name": "Accuracy"}
    )).json()
    r = await client.delete(f"/v1/model-cards/{card['id']}/metrics/{metric['id']}")
    assert r.status_code == 200
    tree = (await client.get(f"/v1/model-cards/{card['id']}")).json()
    assert tree["metrics"] == []


async def test_add_metric_requires_name_and_value(client: httpx.AsyncClient):
    card = await _create_card(client)
    r = await client.post(f"/v1/model-cards/{card['id']}/metrics", json={"value": 0.9})
    assert r.status_code == 422
    r2 = await client.post(f"/v1/model-cards/{card['id']}/metrics", json={"name": "Accuracy"})
    assert r2.status_code == 422


# ---------------------------------------------------------------------------
# POST /model-cards/{id}/sources  +  DELETE /model-cards/{id}/sources/{sid}
# ---------------------------------------------------------------------------

async def test_add_source(client: httpx.AsyncClient):
    card = await _create_card(client)
    r = await client.post(
        f"/v1/model-cards/{card['id']}/sources",
        json={"url": "https://arxiv.org/abs/2301.00001", "name": "Our Paper"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["id"].startswith("MCS-")
    assert body["url"] == "https://arxiv.org/abs/2301.00001"
    assert body["name"] == "Our Paper"


async def test_source_appears_in_tree(client: httpx.AsyncClient):
    card = await _create_card(client)
    await client.post(f"/v1/model-cards/{card['id']}/sources", json={"url": "https://example.com"})
    tree = (await client.get(f"/v1/model-cards/{card['id']}")).json()
    assert len(tree["sources"]) == 1
    assert tree["sources"][0]["url"] == "https://example.com"


async def test_delete_source(client: httpx.AsyncClient):
    card = await _create_card(client)
    source = (await client.post(
        f"/v1/model-cards/{card['id']}/sources", json={"url": "https://example.com"}
    )).json()
    r = await client.delete(f"/v1/model-cards/{card['id']}/sources/{source['id']}")
    assert r.status_code == 200
    tree = (await client.get(f"/v1/model-cards/{card['id']}")).json()
    assert tree["sources"] == []


async def test_add_source_requires_url(client: httpx.AsyncClient):
    card = await _create_card(client)
    r = await client.post(f"/v1/model-cards/{card['id']}/sources", json={"name": "Paper"})
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# POST /model-cards/{id}/datasets
# ---------------------------------------------------------------------------

async def test_add_dataset_minimal(client: httpx.AsyncClient):
    card = await _create_card(client)
    r = await client.post(
        f"/v1/model-cards/{card['id']}/datasets",
        json={"name": "Cancer Dataset", "type": "train"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["id"].startswith("MCD-")
    assert body["name"] == "Cancer Dataset"
    assert body["type"] == "train"
    assert body["preparations"] == []
    assert body["measurements"] == []
    assert body["feature_stores"] == []


async def test_add_dataset_with_all_children(client: httpx.AsyncClient):
    card = await _create_card(client)
    payload = {
        "name": "Cancer Dataset",
        "type": "train",
        "origin": "Internal clinical records",
        "is_personal_data": True,
        "assumptions": "Representative sample assumed",
        "potential_biases": "Gender imbalance possible",
        "preparations": [
            {"operation": "normalisation"},
            {"operation": "tokenisation", "description": "WordPiece"},
        ],
        "measurements": [
            {"measure": "gender distribution", "value": "60% female, 40% male"}
        ],
        "feature_stores": [
            {
                "store_name": "customer-fs",
                "groups": [
                    {"name": "demographics", "version": "v2", "origin": "CRM"}
                ],
            }
        ],
    }
    r = await client.post(f"/v1/model-cards/{card['id']}/datasets", json=payload)
    assert r.status_code == 201
    body = r.json()
    assert body["origin"] == "Internal clinical records"
    assert body["is_personal_data"] is True
    # preparations in order
    assert len(body["preparations"]) == 2
    assert body["preparations"][0]["operation"] == "normalisation"
    assert body["preparations"][0]["order"] == 0
    assert body["preparations"][1]["operation"] == "tokenisation"
    assert body["preparations"][1]["order"] == 1
    # measurements
    assert body["measurements"][0]["measure"] == "gender distribution"
    # feature stores + groups
    assert len(body["feature_stores"]) == 1
    fs = body["feature_stores"][0]
    assert fs["store_name"] == "customer-fs"
    assert fs["id"].startswith("MCF-")
    assert fs["groups"][0]["name"] == "demographics"
    assert fs["groups"][0]["id"].startswith("MCG-")


async def test_dataset_appears_in_card_tree(client: httpx.AsyncClient):
    card = await _create_card(client)
    await _create_dataset(client, card["id"], {"name": "My Dataset", "type": "val"})
    tree = (await client.get(f"/v1/model-cards/{card['id']}")).json()
    assert len(tree["datasets"]) == 1
    assert tree["datasets"][0]["name"] == "My Dataset"


async def test_add_dataset_requires_name_and_type(client: httpx.AsyncClient):
    card = await _create_card(client)
    r = await client.post(f"/v1/model-cards/{card['id']}/datasets", json={"name": "X"})
    assert r.status_code == 422
    r2 = await client.post(f"/v1/model-cards/{card['id']}/datasets", json={"type": "train"})
    assert r2.status_code == 422


async def test_add_dataset_invalid_type(client: httpx.AsyncClient):
    card = await _create_card(client)
    r = await client.post(
        f"/v1/model-cards/{card['id']}/datasets",
        json={"name": "X", "type": "invalid"},
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# PATCH /model-cards/{id}/datasets/{did}
# ---------------------------------------------------------------------------

async def test_patch_dataset_scalars(client: httpx.AsyncClient):
    card = await _create_card(client)
    dataset = await _create_dataset(
        client, card["id"],
        {
            "name": "My Dataset",
            "type": "train",
            "preparations": [{"operation": "normalisation"}],
        },
    )
    did = dataset["id"]
    r = await client.patch(
        f"/v1/model-cards/{card['id']}/datasets/{did}",
        json={"origin": "Internal records", "is_personal_data": True},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["origin"] == "Internal records"
    assert body["is_personal_data"] is True
    # preparations untouched
    assert len(body["preparations"]) == 1
    assert body["preparations"][0]["operation"] == "normalisation"


async def test_patch_dataset_not_found(client: httpx.AsyncClient):
    card = await _create_card(client)
    r = await client.patch(
        f"/v1/model-cards/{card['id']}/datasets/MCD-NOTFOUND",
        json={"origin": "x"},
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PUT /model-cards/{id}/datasets/{did}  — full replace
# ---------------------------------------------------------------------------

async def test_put_dataset_replaces_children(client: httpx.AsyncClient):
    card = await _create_card(client)
    dataset = await _create_dataset(
        client, card["id"],
        {
            "name": "Dataset",
            "type": "train",
            "preparations": [
                {"operation": "normalisation"},
                {"operation": "tokenisation"},
            ],
        },
    )
    did = dataset["id"]
    # PUT with different preparations
    r = await client.put(
        f"/v1/model-cards/{card['id']}/datasets/{did}",
        json={
            "name": "Dataset",
            "type": "train",
            "preparations": [{"operation": "augmentation"}],
        },
    )
    assert r.status_code == 200
    # old two preparations replaced by one
    ds = next(d for d in r.json()["datasets"] if d["id"] == did)
    assert len(ds["preparations"]) == 1
    assert ds["preparations"][0]["operation"] == "augmentation"


async def test_put_dataset_preserves_dataset_id(client: httpx.AsyncClient):
    card = await _create_card(client)
    dataset = await _create_dataset(client, card["id"])
    did = dataset["id"]
    r = await client.put(
        f"/v1/model-cards/{card['id']}/datasets/{did}",
        json={"name": "Updated Name", "type": "test"},
    )
    assert r.status_code == 200
    ds = next(d for d in r.json()["datasets"] if d["id"] == did)
    assert ds["name"] == "Updated Name"
    assert ds["type"] == "test"


async def test_put_dataset_not_found(client: httpx.AsyncClient):
    card = await _create_card(client)
    r = await client.put(
        f"/v1/model-cards/{card['id']}/datasets/MCD-NOTFOUND",
        json={"name": "X", "type": "train"},
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /model-cards/{id}/datasets/{did}
# ---------------------------------------------------------------------------

async def test_delete_dataset(client: httpx.AsyncClient):
    card = await _create_card(client)
    dataset = await _create_dataset(client, card["id"])
    r = await client.delete(f"/v1/model-cards/{card['id']}/datasets/{dataset['id']}")
    assert r.status_code == 200
    tree = (await client.get(f"/v1/model-cards/{card['id']}")).json()
    assert tree["datasets"] == []


async def test_delete_dataset_not_found(client: httpx.AsyncClient):
    card = await _create_card(client)
    r = await client.delete(f"/v1/model-cards/{card['id']}/datasets/MCD-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# GET /model-cards/{id}/systems  — existing join-table read
# ---------------------------------------------------------------------------

async def test_get_model_card_systems_empty(client: httpx.AsyncClient):
    card = await _create_card(client)
    r = await client.get(f"/v1/model-cards/{card['id']}/systems")
    assert r.status_code == 200
    assert r.json() == []
