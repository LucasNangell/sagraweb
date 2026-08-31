"""Endpoints leves para opções de filtros da lista de OSs."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field

from services.os_filter_options_service import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    fetch_distinct_years,
    search_products,
    search_requesters,
)

router = APIRouter(tags=["os-filter-options"])


class FilterOptionItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    value: str
    label: str
    count: Optional[int] = None


class FilterOptionsResponse(BaseModel):
    data: List[FilterOptionItem] = Field(default_factory=list)


class YearsResponse(BaseModel):
    data: List[int] = Field(default_factory=list)


@router.get("/os/filter-options/years", response_model=YearsResponse)
def get_filter_years():
    return YearsResponse(data=fetch_distinct_years())


@router.get("/os/filter-options/products", response_model=FilterOptionsResponse)
def get_filter_products(
    q: Optional[str] = Query(None),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
):
    rows = search_products(q=q, limit=limit)
    return FilterOptionsResponse(data=[FilterOptionItem.model_validate(r) for r in rows])


@router.get("/os/filter-options/requesters", response_model=FilterOptionsResponse)
def get_filter_requesters(
    q: Optional[str] = Query(None),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    categorias: Optional[List[str]] = Query(None),
):
    rows = search_requesters(q=q, limit=limit, categorias=categorias)
    return FilterOptionsResponse(data=[FilterOptionItem.model_validate(r) for r in rows])
