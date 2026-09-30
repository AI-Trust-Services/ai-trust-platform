"""BGE-M3 dense Embeddings via FlagEmbedding.

Nur der dense-Ausgang wird genutzt; der lexikalische Kanal kommt aus BM25
(Stellvertreter für Postgres-FTS in Phase 1). Vektoren werden L2-normalisiert,
damit Kosinus-Ähnlichkeit == Skalarprodukt gilt.
"""

from __future__ import annotations

import numpy as np


class Embedder:
    def __init__(self, model_name: str, use_fp16: bool = True):
        from FlagEmbedding import BGEM3FlagModel

        self._model = BGEM3FlagModel(model_name, use_fp16=use_fp16)

    def encode(self, texts: list[str]) -> np.ndarray:
        out = self._model.encode(
            texts,
            return_dense=True,
            return_sparse=False,
            return_colbert_vecs=False,
        )
        vecs = np.asarray(out["dense_vecs"], dtype=np.float32)
        norms = np.linalg.norm(vecs, axis=1, keepdims=True)
        return vecs / np.clip(norms, 1e-12, None)
