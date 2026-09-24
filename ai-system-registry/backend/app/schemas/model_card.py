"""Pydantic v2 schemas for Model Card."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Nested input types (used inside DatasetCreate / PUT body)
# ---------------------------------------------------------------------------

class PreparationCreate(BaseModel):
    operation: str = Field(..., max_length=200)
    description: str | None = None


class MeasurementCreate(BaseModel):
    measure: str = Field(..., max_length=200)
    value: str = Field(..., max_length=200)


class FeatureStoreGroupCreate(BaseModel):
    name: str = Field(..., max_length=200)
    version: str | None = Field(default=None, max_length=100)
    origin: str | None = Field(default=None, max_length=200)


class FeatureStoreCreate(BaseModel):
    store_name: str = Field(..., max_length=200)
    groups: list[FeatureStoreGroupCreate] = []


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class ModelCardCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    version: str | None = Field(default=None, max_length=50)
    base_model: str | None = Field(default=None, max_length=200)
    library_name: str | None = Field(default=None, max_length=100)
    license: str | None = Field(default=None, max_length=100)
    license_name: str | None = Field(default=None, max_length=200)
    license_link: str | None = Field(default=None, max_length=500)
    training_commit: str | None = Field(default=None, max_length=100)
    validation_status: str | None = Field(default=None, max_length=100)
    task_type: str | None = Field(default=None, max_length=100)
    task_name: str | None = Field(default=None, max_length=200)
    tags: list[str] = []


class ModelCardPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    version: str | None = Field(default=None, max_length=50)
    base_model: str | None = Field(default=None, max_length=200)
    library_name: str | None = Field(default=None, max_length=100)
    license: str | None = Field(default=None, max_length=100)
    license_name: str | None = Field(default=None, max_length=200)
    license_link: str | None = Field(default=None, max_length=500)
    training_commit: str | None = Field(default=None, max_length=100)
    validation_status: str | None = Field(default=None, max_length=100)
    task_type: str | None = Field(default=None, max_length=100)
    task_name: str | None = Field(default=None, max_length=200)
    tags: list[str] | None = None


class MetricCreate(BaseModel):
    value: float
    name: str = Field(..., max_length=200)
    dataset: str | None = Field(default=None, max_length=200)
    config: str | None = Field(default=None, max_length=200)
    args: dict | None = None


class SourceCreate(BaseModel):
    url: str = Field(..., max_length=500)
    name: str | None = Field(default=None, max_length=200)


class DatasetCreate(BaseModel):
    name: str = Field(..., max_length=200)
    type: Literal["train", "val", "test", "train_cv"]
    revision: str | None = Field(default=None, max_length=200)
    origin: str | None = None
    is_personal_data: bool | None = None
    assumptions: str | None = None
    assessment_availability: str | None = None
    assessment_quantity: str | None = None
    assessment_suitability: str | None = None
    potential_biases: str | None = None
    # preparation order is implicit by list order
    preparations: list[PreparationCreate] = []
    measurements: list[MeasurementCreate] = []
    feature_stores: list[FeatureStoreCreate] = []


class DatasetPatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    type: Literal["train", "val", "test", "train_cv"] | None = None
    revision: str | None = Field(default=None, max_length=200)
    origin: str | None = None
    is_personal_data: bool | None = None
    assumptions: str | None = None
    assessment_availability: str | None = None
    assessment_quantity: str | None = None
    assessment_suitability: str | None = None
    potential_biases: str | None = None


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class _OrmResponse(BaseModel):
    model_config = {"from_attributes": True}


class MetricResponse(_OrmResponse):
    id: str
    value: float
    name: str
    dataset: str | None
    config: str | None
    args: dict | None


class SourceResponse(_OrmResponse):
    id: str
    url: str
    name: str | None


class PreparationResponse(_OrmResponse):
    id: str
    order: int
    operation: str
    description: str | None


class MeasurementResponse(_OrmResponse):
    id: str
    measure: str
    value: str


class FeatureStoreGroupResponse(_OrmResponse):
    id: str
    name: str
    version: str | None
    origin: str | None


class FeatureStoreResponse(_OrmResponse):
    id: str
    store_name: str
    groups: list[FeatureStoreGroupResponse]


class DatasetResponse(_OrmResponse):
    id: str
    name: str
    type: str
    revision: str | None
    origin: str | None
    is_personal_data: bool | None
    assumptions: str | None
    assessment_availability: str | None
    assessment_quantity: str | None
    assessment_suitability: str | None
    potential_biases: str | None
    preparations: list[PreparationResponse]
    measurements: list[MeasurementResponse]
    feature_stores: list[FeatureStoreResponse]


class ModelCardResponse(_OrmResponse):
    id: str
    name: str
    version: str | None
    base_model: str | None
    library_name: str | None
    license: str | None
    license_name: str | None
    license_link: str | None
    training_commit: str | None
    validation_status: str | None
    task_type: str | None
    task_name: str | None
    tags: list[str]
    metrics: list[MetricResponse] = []
    sources: list[SourceResponse] = []
    datasets: list[DatasetResponse] = []
    created_at: datetime
    updated_at: datetime
