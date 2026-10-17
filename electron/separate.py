"""Separa um WAV estéreo em faixas (voz, bateria, baixo, ...) com o Demucs.

Uso: python separate.py --input in.wav --out pasta --model htdemucs [--two-stems] [--device cuda|cpu]

Lê e grava com soundfile (sem torchaudio) e imprime o progresso como linhas JSON no stdout.
"""

import argparse
import json
import os
import sys


def emit(**msg):
    print(json.dumps(msg), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="htdemucs")
    ap.add_argument("--two-stems", action="store_true")
    ap.add_argument("--device", default="auto")
    args = ap.parse_args()

    emit(stage="loading", text="Carregando o modelo…")
    import numpy as np
    import soundfile as sf
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"

    model = get_model(args.model)
    model.eval()

    wav, sr = sf.read(args.input, dtype="float32", always_2d=True)
    if sr != model.samplerate:
        raise SystemExit(f"Taxa de amostragem {sr} diferente da esperada ({model.samplerate})")
    if wav.shape[1] == 1:
        wav = np.repeat(wav, 2, axis=1)
    mix = torch.from_numpy(wav[:, :2].T.copy())

    # Normalização igual à do demucs.separate.
    ref = mix.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    mix = (mix - mean) / std

    def run(dev):
        emit(stage="separating", text=f"Separando ({'GPU' if dev == 'cuda' else 'CPU'})…", device=dev)
        with torch.no_grad():
            # progress=True escreve uma barra tqdm no stderr; o Electron lê a porcentagem dela.
            return apply_model(model, mix[None], device=dev, shifts=1, split=True, overlap=0.25, progress=True)[0]

    try:
        sources = run(device)
    except RuntimeError as err:
        if device == "cuda" and "out of memory" in str(err).lower():
            torch.cuda.empty_cache()
            emit(stage="fallback", text="Memória da GPU insuficiente, usando a CPU…")
            sources = run("cpu")
        else:
            raise

    sources = sources * std + mean
    names = list(model.sources)
    stems = {name: sources[i] for i, name in enumerate(names)}
    if args.two_stems:
        vocals = stems["vocals"]
        rest = sum(src for name, src in stems.items() if name != "vocals")
        stems = {"vocals": vocals, "no_vocals": rest}

    os.makedirs(args.out, exist_ok=True)
    written = []
    for name, src in stems.items():
        path = os.path.join(args.out, f"{name}.wav")
        sf.write(path, src.cpu().numpy().T, sr, subtype="PCM_24")
        written.append({"name": name, "path": path})
    emit(stage="done", stems=written)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as err:  # noqa: BLE001 - erro vai para a interface
        emit(stage="error", text=f"{type(err).__name__}: {err}")
        sys.exit(1)
