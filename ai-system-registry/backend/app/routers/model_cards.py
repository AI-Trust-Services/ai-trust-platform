from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, select

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_READ, SYSTEMS_WRITE
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.ai_system_model_card import AISystemModelCard
from ai_trust_persistence.models.model_card import ModelCard
from ai_trust_persistence.models.model_card_dataset import ModelCardDataset
from ai_trust_persistence.models.model_card_dataset_measurement import ModelCardDatasetMeasurement
from ai_trust_persistence.models.model_card_dataset_preparation import ModelCardDatasetPreparation
from ai_trust_persistence.models.model_card_feature_store import ModelCardFeatureStore
from ai_trust_persistence.models.model_card_feature_store_group import ModelCardFeatureStoreGroup
from ai_trust_persistence.models.model_card_metric import ModelCardMetric
from ai_trust_persistence.models.model_card_source import ModelCardSource
from app.ids import new_id
from app.schemas import (
    DatasetCreate,
    DatasetPatch,
    DatasetResponse,
    FeatureStoreGroupResponse,
    FeatureStoreResponse,
    MeasurementResponse,
    MetricCreate,
    MetricResponse,
    ModelCardCreate,
    ModelCardPatch,
    ModelCardResponse,
    PreparationResponse,
    SourceCreate,
    SourceResponse,
)
from app.schemas.system_model import ModelSystemResponse

router = APIRouter(tags=["model-cards"])
logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _dict_group_by(items, attr: str) -> defaultdict[str, list]:
    # Groups a list of ORM objects.
    # dict [attribute name] -> list of items with the attribute value
    result: defaultdict[str, list] = defaultdict(list)
    for item in items:
        result[getattr(item, attr)].append(item)
    return result


def _build_dataset_response(ds, preps_by_ds, meas_by_ds, fs_by_ds) -> DatasetResponse:
    # Builds a DatasetResponse from pre-fetched lookup dicts (avoids N+1 queries).
    # ds:          ModelCardDataset ORM row
    # preps_by_ds: dataset_id → [ModelCardDatasetPreparation], ordered
    # meas_by_ds:  dataset_id → [ModelCardDatasetMeasurement]
    # fs_by_ds:    dataset_id → [FeatureStoreResponse] (already assembled)
    return DatasetResponse.model_validate(ds, update={
        "preparations":   [PreparationResponse.model_validate(p) for p in preps_by_ds.get(ds.id, [])],
        "measurements":   [MeasurementResponse.model_validate(m) for m in meas_by_ds.get(ds.id, [])],
        "feature_stores": fs_by_ds.get(ds.id, []),
    })


async def _load_card_tree(session, card_id: str) -> ModelCardResponse | None:
    # Returns the full nested ModelCardResponse or None if the card does not exist.
    result = await session.execute(select(ModelCard).where(ModelCard.id == card_id))
    card = result.scalar_one_or_none()
    if card is None:
        return None

    metrics = (await session.execute(
        select(ModelCardMetric).where(ModelCardMetric.model_card_id == card_id)
    )).scalars().all()

    sources = (await session.execute(
        select(ModelCardSource).where(ModelCardSource.model_card_id == card_id)
    )).scalars().all()

    datasets = (await session.execute(
        select(ModelCardDataset).where(ModelCardDataset.model_card_id == card_id)
    )).scalars().all()

    dataset_ids = [d.id for d in datasets]

    if dataset_ids:
        preps = (await session.execute(
            select(ModelCardDatasetPreparation)
            .where(ModelCardDatasetPreparation.dataset_id.in_(dataset_ids))
            .order_by(ModelCardDatasetPreparation.order)
        )).scalars().all()

        measurements = (await session.execute(
            select(ModelCardDatasetMeasurement)
            .where(ModelCardDatasetMeasurement.dataset_id.in_(dataset_ids))
        )).scalars().all()

        feature_stores = (await session.execute(
            select(ModelCardFeatureStore)
            .where(ModelCardFeatureStore.dataset_id.in_(dataset_ids))
        )).scalars().all()

        store_ids = [fs.id for fs in feature_stores]
        feature_groups = (await session.execute(
            select(ModelCardFeatureStoreGroup)
            .where(ModelCardFeatureStoreGroup.feature_store_id.in_(store_ids))
        )).scalars().all() if store_ids else []
    else:
        preps = measurements = feature_stores = feature_groups = []

    preps_by_ds     = _dict_group_by(preps, "dataset_id")
    meas_by_ds      = _dict_group_by(measurements, "dataset_id")
    feature_groups_by_store = _dict_group_by(feature_groups, "feature_store_id")

    fs_by_ds: defaultdict[str, list] = defaultdict(list)
    # create feature store by dataset
    for fs in feature_stores:
        fs_feature_groups = list()
        # checks if feature store has any feature groups
        for feature_group in feature_groups_by_store.get(fs.id, []):
            fs_feature_groups.append(
                FeatureStoreGroupResponse.model_validate(feature_group)
            )
        fs_by_ds[fs.dataset_id].append(
            FeatureStoreResponse(
                id=fs.id,
                store_name=fs.store_name,
                groups=fs_feature_groups,
            )
        )

    return ModelCardResponse.model_validate(card, update={
        "metrics":  [MetricResponse.model_validate(m) for m in metrics],
        "sources":  [SourceResponse.model_validate(s) for s in sources],
        "datasets": [
            _build_dataset_response(ds, preps_by_ds, meas_by_ds, fs_by_ds) 
            for ds in datasets],
    })


async def _load_dataset_response(session, ds_id: str) -> DatasetResponse | None:
    # Single-dataset loader for POST/PATCH responses
    # it is not use inside _load_card_tree,
    # which batches all child queries with IN clauses to avoid N×4 queries per card.
    # (N + 1 query problem)
    result = await session.execute(
        select(ModelCardDataset).where(ModelCardDataset.id == ds_id)
    )
    ds = result.scalar_one_or_none()
    if ds is None:
        return None

    preps = (await session.execute(
        select(ModelCardDatasetPreparation)
        .where(ModelCardDatasetPreparation.dataset_id == ds_id)
        .order_by(ModelCardDatasetPreparation.order)
    )).scalars().all()

    measurements = (await session.execute(
        select(ModelCardDatasetMeasurement)
        .where(ModelCardDatasetMeasurement.dataset_id == ds_id)
    )).scalars().all()

    feature_stores = (await session.execute(
        select(ModelCardFeatureStore).where(ModelCardFeatureStore.dataset_id == ds_id)
    )).scalars().all()

    store_ids = [fs.id for fs in feature_stores]
    groups = (await session.execute(
        select(ModelCardFeatureStoreGroup)
        .where(ModelCardFeatureStoreGroup.feature_store_id.in_(store_ids))
    )).scalars().all() if store_ids else []


    groups_by_store = _dict_group_by(groups, "feature_store_id")
    fs_by_ds: defaultdict[str, list] = defaultdict(list)
    for fs in feature_stores:
        fs_by_ds[fs.dataset_id].append(
            FeatureStoreResponse(
                id=fs.id,
                store_name=fs.store_name,
                groups=[FeatureStoreGroupResponse.model_validate(g) for g in groups_by_store.get(fs.id, [])],
            )
        )

    return _build_dataset_response(
        ds, 
        _dict_group_by(preps, "dataset_id"), 
        _dict_group_by(measurements, "dataset_id"), 
        fs_by_ds
    )


async def _insert_dataset_children(session, ds_id: str, body: DatasetCreate) -> None:
    for i, prep in enumerate(body.preparations):
        session.add(ModelCardDatasetPreparation(
            id=new_id("MCP"),
            dataset_id=ds_id,
            order=i,
            operation=prep.operation,
            description=prep.description,
        ))
    for meas in body.measurements:
        session.add(ModelCardDatasetMeasurement(
            id=new_id("MCE"),
            dataset_id=ds_id,
            measure=meas.measure,
            value=meas.value,
        ))
    for fs_body in body.feature_stores:
        fs_id = new_id("MCF")
        session.add(
            ModelCardFeatureStore(
                id=fs_id, dataset_id=ds_id, store_name=fs_body.store_name)
            )
        for group in fs_body.groups:
            session.add(ModelCardFeatureStoreGroup(
                id=new_id("MCG"),
                feature_store_id=fs_id,
                name=group.name,
                version=group.version,
                origin=group.origin,
            ))


# ---------------------------------------------------------------------------
# Model card CRUD
# ---------------------------------------------------------------------------

@router.get(
        "/model-cards", 
        response_model=list[ModelCardResponse], 
        dependencies=[Depends(require_permission(SYSTEMS_READ))])
async def list_model_cards(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[ModelCardResponse]:
    async with SessionLocal() as session:
        result = await session.execute(
            select(ModelCard).order_by(ModelCard.name).limit(limit).offset(offset)
        )
        return [ModelCardResponse.model_validate(r) for r in result.scalars().all()]


@router.post(
        "/model-cards", 
        response_model=ModelCardResponse, 
        status_code=201, 
        dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def create_model_card(body: ModelCardCreate) -> ModelCardResponse:
    async with SessionLocal() as session:
        row = ModelCard(id=new_id("MDL"), **body.model_dump())
        session.add(row)
        await session.commit()
        tree = await _load_card_tree(session, row.id)
    logger.info("model_card.created", extra={"model_id": row.id, "model_name": row.name})
    return tree  # type: ignore[return-value]


@router.get(
        "/model-cards/{card_id}", 
        response_model=ModelCardResponse, 
        dependencies=[Depends(require_permission(SYSTEMS_READ))])
async def get_model_card(card_id: str) -> ModelCardResponse:
    async with SessionLocal() as session:
        tree = await _load_card_tree(session, card_id)
    if tree is None:
        raise HTTPException(404, f"Model card {card_id} not found")
    return tree


@router.patch(
        "/model-cards/{card_id}", 
        response_model=ModelCardResponse, 
        dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def patch_model_card(card_id: str, body: ModelCardPatch) -> ModelCardResponse:
    async with SessionLocal() as session:
        result = await session.execute(select(ModelCard).where(ModelCard.id == card_id))
        row = result.scalar_one_or_none()
        if row is None:
            raise HTTPException(404, f"Model card {card_id} not found")
        # model_fields_set contains only fields the client actually sent
        for field in body.model_fields_set:
            setattr(row, field, getattr(body, field))
        row.updated_at = datetime.now(timezone.utc)
        await session.commit()
        tree = await _load_card_tree(session, card_id)
    return tree  # type: ignore[return-value]


@router.delete(
        "/model-cards/{card_id}", 
        dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def delete_model_card(card_id: str) -> dict:
    async with SessionLocal() as session:
        result = await session.execute(select(ModelCard).where(ModelCard.id == card_id))
        row = result.scalar_one_or_none()
        if row is None:
            raise HTTPException(404, f"Model card {card_id} not found")
        await session.delete(row)
        await session.commit()
    logger.info("model_card.deleted", extra={"model_id": card_id})
    return {"status": "deleted", "id": card_id}


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

@router.post(
        "/model-cards/{card_id}/metrics", 
        response_model=MetricResponse, 
        status_code=201, 
        dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def add_metric(card_id: str, body: MetricCreate) -> MetricResponse:
    async with SessionLocal() as session:
        result = await session.execute(select(ModelCard).where(ModelCard.id == card_id))
        if result.scalar_one_or_none() is None:
            raise HTTPException(404, f"Model card {card_id} not found")
        row = ModelCardMetric(
            id=new_id("MCM"), 
            model_card_id=card_id, 
            **body.model_dump())
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return MetricResponse.model_validate(row)


@router.delete(
        "/model-cards/{card_id}/metrics/{metric_id}", 
        dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def delete_metric(card_id: str, metric_id: str) -> dict:
    async with SessionLocal() as session:
        result = await session.execute(
            select(ModelCardMetric).where(
                ModelCardMetric.id == metric_id, 
                ModelCardMetric.model_card_id == card_id
            )
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise HTTPException(404, f"Metric {metric_id} not found")
        await session.delete(row)
        await session.commit()
    return {"status": "deleted", "id": metric_id}


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

@router.post(
        "/model-cards/{card_id}/sources", 
        response_model=SourceResponse, 
        status_code=201, 
        dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def add_source(card_id: str, body: SourceCreate) -> SourceResponse:
    async with SessionLocal() as session:
        result = await session.execute(select(ModelCard).where(ModelCard.id == card_id))
        if result.scalar_one_or_none() is None:
            raise HTTPException(404, f"Model card {card_id} not found")
        row = ModelCardSource(
            id=new_id("MCS"), 
            model_card_id=card_id, 
            **body.model_dump())
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return SourceResponse.model_validate(row)


@router.delete(
        "/model-cards/{card_id}/sources/{source_id}", 
        dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def delete_source(card_id: str, source_id: str) -> dict:
    async with SessionLocal() as session:
        result = await session.execute(
            select(ModelCardSource).where(
                ModelCardSource.id == source_id, 
                ModelCardSource.model_card_id == card_id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise HTTPException(404, f"Source {source_id} not found")
        await session.delete(row)
        await session.commit()
    return {"status": "deleted", "id": source_id}


# ---------------------------------------------------------------------------
# Datasets
# ---------------------------------------------------------------------------

@router.post(
        "/model-cards/{card_id}/datasets", 
        response_model=DatasetResponse, 
        status_code=201, 
        dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def add_dataset(card_id: str, body: DatasetCreate) -> DatasetResponse:
    async with SessionLocal() as session:
        result = await session.execute(select(ModelCard).where(ModelCard.id == card_id))
        if result.scalar_one_or_none() is None:
            raise HTTPException(404, f"Model card {card_id} not found")
        ds_id = new_id("MCD")
        ds = ModelCardDataset(
            id=ds_id,
            model_card_id=card_id,
            name=body.name,
            type=body.type,
            revision=body.revision,
            origin=body.origin,
            is_personal_data=body.is_personal_data,
            assumptions=body.assumptions,
            assessment_availability=body.assessment_availability,
            assessment_quantity=body.assessment_quantity,
            assessment_suitability=body.assessment_suitability,
            potential_biases=body.potential_biases,
        )
        session.add(ds)
        await _insert_dataset_children(session, ds_id, body)
        await session.commit()
        response = await _load_dataset_response(session, ds_id)
    return response  # type: ignore[return-value]


@router.patch(
        "/model-cards/{card_id}/datasets/{ds_id}", 
        response_model=DatasetResponse, 
        dependencies=[Depends(require_permission(SYSTEMS_WRITE))]
    )
async def patch_dataset(card_id: str, ds_id: str, body: DatasetPatch) -> DatasetResponse:
    updates = body.model_dump(exclude_none=True)
    async with SessionLocal() as session:
        result = await session.execute(
            select(ModelCardDataset).where(
                ModelCardDataset.id == ds_id, 
                ModelCardDataset.model_card_id == card_id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise HTTPException(404, f"Dataset {ds_id} not found")
        for field, value in updates.items():
            setattr(row, field, value)
        await session.commit()
        response = await _load_dataset_response(session, ds_id)
    return response  # type: ignore[return-value]


@router.put(
        "/model-cards/{card_id}/datasets/{ds_id}", 
        response_model=ModelCardResponse, 
        dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def replace_dataset(card_id: str, ds_id: str, body: DatasetCreate) -> ModelCardResponse:
    async with SessionLocal() as session:
        result = await session.execute(
            select(ModelCardDataset).where(
                ModelCardDataset.id == ds_id, 
                ModelCardDataset.model_card_id == card_id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise HTTPException(404, f"Dataset {ds_id} not found")

        # Replace scalars
        for field in (
            "name", "type", "revision", "origin", "is_personal_data", "assumptions",
            "assessment_availability", "assessment_quantity", "assessment_suitability", 
            "potential_biases"
            ):
            setattr(row, field, getattr(body, field))

        # Drop + recreate children (CASCADE handles feature_store_groups)
        await session.execute(delete(ModelCardDatasetPreparation).where(ModelCardDatasetPreparation.dataset_id == ds_id))
        await session.execute(delete(ModelCardDatasetMeasurement).where(ModelCardDatasetMeasurement.dataset_id == ds_id))
        await session.execute(delete(ModelCardFeatureStore).where(ModelCardFeatureStore.dataset_id == ds_id))
        await _insert_dataset_children(session, ds_id, body)
        await session.commit()
        tree = await _load_card_tree(session, card_id)
    return tree  # type: ignore[return-value]


@router.delete(
        "/model-cards/{card_id}/datasets/{ds_id}", 
        dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def delete_dataset(card_id: str, ds_id: str) -> dict:
    async with SessionLocal() as session:
        result = await session.execute(
            select(ModelCardDataset).where(
                ModelCardDataset.id == ds_id, 
                ModelCardDataset.model_card_id == card_id
            )
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise HTTPException(404, f"Dataset {ds_id} not found")
        await session.delete(row)
        await session.commit()
    return {"status": "deleted", "id": ds_id}


# ---------------------------------------------------------------------------
# Systems linked to this model card
# ---------------------------------------------------------------------------

@router.get("/model-cards/{card_id}/systems", response_model=list[ModelSystemResponse], dependencies=[Depends(require_permission(SYSTEMS_READ))])
async def list_model_systems(card_id: str) -> list[ModelSystemResponse]:
    async with SessionLocal() as session:
        result = await session.execute(select(ModelCard).where(ModelCard.id == card_id))
        if result.scalar_one_or_none() is None:
            raise HTTPException(404, f"Model card {card_id} not found")
        result = await session.execute(
            select(AISystem, AISystemModelCard.__table__.c.role)
            .join(AISystemModelCard.__table__, AISystem.id == AISystemModelCard.__table__.c.system_id)
            .where(AISystemModelCard.__table__.c.model_card_id == card_id)
            .order_by(AISystem.name)
        )
        return [ModelSystemResponse.from_system(sys, role) for sys, role in result.all()]
