"""Hospeda plugins VST3 com o pedalboard (https://github.com/spotify/pedalboard).

Comandos (saída em JSON no stdout):
  editor  --plugin P [--state S]          abre a interface do plugin; ao fechar, devolve o estado
  process --plugin P [--state S] --input IN --output OUT   processa um WAV pelo plugin
  info    --plugin P                      nome e se é instrumento
"""

import argparse
import base64
import json
import sys


def emit(**msg):
    print(json.dumps(msg), flush=True)


def load(path, state):
    from pedalboard import load_plugin

    plugin = load_plugin(path)
    if state:
        plugin.raw_state = base64.b64decode(state)
    return plugin


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["editor", "process", "info"])
    ap.add_argument("--plugin", required=True)
    ap.add_argument("--state", default="")
    ap.add_argument("--input")
    ap.add_argument("--output")
    args = ap.parse_args()

    plugin = load(args.plugin, args.state)
    if args.command == "info":
        emit(name=plugin.name, instrument=bool(getattr(plugin, "is_instrument", False)))
        return
    if getattr(plugin, "is_instrument", False):
        raise SystemExit("Este plugin é um instrumento; só efeitos de áudio são suportados.")

    if args.command == "editor":
        plugin.show_editor()  # bloqueia até a janela do plugin ser fechada
        emit(state=base64.b64encode(plugin.raw_state).decode("ascii"), name=plugin.name)
        return

    from pedalboard.io import AudioFile

    with AudioFile(args.input) as f:
        audio = f.read(f.frames)
        sr = f.samplerate
    out = plugin(audio, sr)
    with AudioFile(args.output, "w", sr, out.shape[0], bit_depth=24) as o:
        o.write(out)
    emit(done=True, frames=int(out.shape[1]))


if __name__ == "__main__":
    try:
        main()
    except SystemExit as e:
        if e.code not in (0, None):
            emit(error=str(e.code))
            sys.exit(1)
    except Exception as err:  # noqa: BLE001 - erro vai para a interface
        emit(error=f"{type(err).__name__}: {err}")
        sys.exit(1)
