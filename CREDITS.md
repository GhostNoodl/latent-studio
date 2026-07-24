# Credits & Third-Party Notices

Latent is a front-end. It orchestrates other people's excellent work rather than
bundling it. This file credits that work and clarifies what Latent does and does not
redistribute.

## What Latent ships in this repository
- Its own application source code (MIT — see `LICENSE`).
- A small number of **ComfyUI workflow JSON files** (`workflows/`) used as the default
  pipelines. These are configuration/graph definitions, not model weights.

## What Latent does NOT ship (downloaded on demand from the original source)
Latent never re-hosts binaries. At setup / first run it downloads these from their
original homes, so you receive them under **their** licenses — Latent is not the
redistributor:

- **ComfyUI** (the engine) — downloaded from the official portable release.
  <https://github.com/comfyanonymous/ComfyUI> (GPL-3.0)
- **ComfyUI-Manager** — <https://github.com/Comfy-Org/ComfyUI-Manager>
- **Custom nodes** the default pipelines use, installed via ComfyUI-Manager:
  - rgthree-comfy — <https://github.com/rgthree/rgthree-comfy>
  - ComfyUI-Easy-Use — <https://github.com/yolain/ComfyUI-Easy-Use>
  - ComfyUI-mxToolkit — <https://github.com/Smirnov75/ComfyUI-mxToolkit>
  - ComfyUI-GGUF — <https://github.com/city96/ComfyUI-GGUF>
  - ComfyUI-KJNodes — <https://github.com/kijai/ComfyUI-KJNodes>
  - ComfyMath — <https://github.com/evanspearman/ComfyMath>
  - WhatDreamsCost-ComfyUI — <https://github.com/WhatDreamscost/WhatDreamsCost-ComfyUI>

## Models (checkpoints, VAEs, upscalers, detectors, video models)
Latent suggests a curated set during onboarding but **downloads each from Civitai or
Hugging Face at your request** — it does not include any model weights. Every model is
the property of its author and is governed by its own license / terms of use, shown on
its source page. You are responsible for complying with those terms. Notable ones to
check before redistributing outputs commercially: Illustrious/SDXL checkpoint licenses
(often CreativeML OpenRAIL-M or creator-specific), the ESRGAN upscalers
(e.g. 4x-UltraSharp is CC-BY-NC-SA), and the LTX-2.3 video model (Lightricks, OpenRAIL).

## Default workflows
The bundled pipelines are adapted from community workflows:
- **"Smooth v4"** (image pipeline) — by DigitalPastel.
  <https://civitai.com/user/DigitalPastel>
- **LTX 2.3 I2V** (video pipeline) — adapted from the official ComfyUI template
  (Lightricks LTX-2.3). <https://docs.comfy.org/tutorials/video/ltx/ltx-2-3>
