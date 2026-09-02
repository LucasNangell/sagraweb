from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SequenciaConfidence = Literal["automatic", "review", "manual"]


class SequenciaBlock(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    title: str
    lines: list[str] = Field(default_factory=list)
    confidence: SequenciaConfidence = "automatic"
    warnings: list[str] = Field(default_factory=list)


class SequenciaSection(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    title: str
    blocks: list[SequenciaBlock] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class SequenciaOsResumo(BaseModel):
    model_config = ConfigDict(extra="allow")

    numero: int
    ano: int
    titulo: str | None = None
    produto: str | None = None
    formato: str | None = None
    tiragem: int | None = None
    paginas: int | None = None


class SequenciaDraft(BaseModel):
    model_config = ConfigDict(extra="allow")

    version: int = 1
    os: SequenciaOsResumo
    source_hash: str
    confidence: SequenciaConfidence = "automatic"
    warnings: list[str] = Field(default_factory=list)
    sections: list[SequenciaSection] = Field(default_factory=list)


class SequenciaResponse(BaseModel):
    draft: SequenciaDraft
    generated_source_hash: str
    saved: bool = False
    source_changed: bool = False
    docx_filename: str | None = None
    docx_download_url: str | None = None
    updated_at: str | None = None


class SequenciaSaveRequest(BaseModel):
    draft: SequenciaDraft


class SequenciaDocxRequest(BaseModel):
    draft: SequenciaDraft | None = None
    overwrite: bool = True


class SequenciaDocxResponse(BaseModel):
    filename: str
    path: str
    download_url: str
