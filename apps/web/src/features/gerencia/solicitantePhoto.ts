import type { DeputadoLookup } from "@/api/auxLookups";

export function solicitantePhotoSearchKey(categoria: string, nome: string): string {
  return `${categoria}|${nome.trim().toLowerCase()}`;
}

export async function loadSolicitantePhoto(args: {
  nome: string;
  categoria: string;
  fetchStatus: (nome: string) => Promise<{ exists: boolean }>;
  fotoUrl: (nome: string) => string;
  fetchDeputado: (nome: string) => Promise<DeputadoLookup>;
}): Promise<{
  photo: string | null;
  usedLocal: boolean;
  deputado?: DeputadoLookup;
}> {
  const nome = args.nome.trim();
  if (nome.length < 3) {
    return { photo: null, usedLocal: false };
  }

  try {
    const status = await args.fetchStatus(nome);
    if (status.exists) {
      return { photo: args.fotoUrl(nome), usedLocal: true };
    }
  } catch (err) {
    console.error(err);
  }

  if (args.categoria !== "Deputado") {
    return { photo: null, usedLocal: false };
  }

  const data = await args.fetchDeputado(nome);
  if (!data.nome) {
    return { photo: null, usedLocal: false };
  }
  return {
    photo: data.foto || null,
    usedLocal: false,
    deputado: data,
  };
}
