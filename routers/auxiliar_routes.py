from fastapi import APIRouter
from database import db

router = APIRouter(prefix="/aux")

@router.get("/categorias")
def get_categorias():
    return db.execute_query("SELECT DISTINCT Categoria FROM tabcategorias ORDER BY Categoria")

@router.get("/situacoes")
def get_situacoes():
    return db.execute_query("SELECT DISTINCT SituacaoLink as Situacao FROM tabAndamento WHERE SituacaoLink IS NOT NULL ORDER BY SituacaoLink")

@router.get("/setores")
def get_setores():
    return db.execute_query("SELECT DISTINCT SetorLink as Setor FROM tabAndamento WHERE SetorLink IS NOT NULL ORDER BY SetorLink")

@router.get("/maquinas")
def get_maquinas():
    return db.execute_query("SELECT DISTINCT MaquinaLink FROM tabDetalhesServico ORDER BY MaquinaLink")

@router.get("/produtos")
def get_produtos():
    return db.execute_query("SELECT DISTINCT TipoPublicacaoLink as Produto FROM tabDetalhesServico ORDER BY TipoPublicacaoLink")

@router.get("/papeis")
def get_papeis():
    return db.execute_query("SELECT DISTINCT Papel FROM tabPapel ORDER BY Papel")

@router.get("/cores")
def get_cores():
    return db.execute_query("SELECT DISTINCT Cor FROM tabCores ORDER BY Cor")