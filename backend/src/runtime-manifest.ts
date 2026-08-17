/**
 * Tested managed-runtime compatibility set. Updating this file is an explicit
 * release task: bootstrap never follows "latest" branches or unpinned wheels.
 */
export const MANAGED_RUNTIME = {
  comfy: {
    // Stable compatibility target containing native MiniMax Music 3 support and
    // its non-dynamic-VRAM inference fix. Existing managed installs are advanced
    // to this exact commit automatically before ComfyUI starts.
    tag: "v0.33.1",
    commit: "72865f4f27eaf5396f8f36370e0a2be3a9a090ee",
    windowsBaseTag: "v0.33.1",
    windows: {
      amd: {
        asset: "ComfyUI_windows_portable_amd.7z",
        sizeBytes: 1_803_834_302,
        sha256: "18a595e4898cce4cf23b9a1299e5bba05ba856772588d25619bc398eb921de45",
      },
      intel: {
        asset: "ComfyUI_windows_portable_intel.7z",
        sizeBytes: 1_720_754_824,
        sha256: "c29e5c19a9d29a8aea5d4ae7811048a409a0748dbde3dde639ce52cc29cf228c",
      },
      nvidia: {
        asset: "ComfyUI_windows_portable_nvidia.7z",
        sizeBytes: 2_133_107_036,
        sha256: "4a221588979b96b8244e0e50b2edca03af732acae1deba69d60aa3b4d60b9dba",
      },
    },
  },
  manager: {
    url: "https://github.com/Comfy-Org/ComfyUI-Manager.git",
    dir: "ComfyUI-Manager",
    commit: "2f3fc41a13bdacff82055b402b445f64c1a27c25",
  },
  nodes: [
    { url: "https://github.com/rgthree/rgthree-comfy.git", dir: "rgthree-comfy", commit: "6b76ee6f2c5a007710b5a16f97c94330d6ecc871" },
    { url: "https://github.com/yolain/ComfyUI-Easy-Use.git", dir: "ComfyUI-Easy-Use", commit: "595e0738a9e3f8d0d9c4d875461b2d2c9e7559c7" },
    { url: "https://github.com/Smirnov75/ComfyUI-mxToolkit.git", dir: "ComfyUI-mxToolkit", commit: "7f7a0e584f12078a1c589645d866ae96bad0cc35" },
    { url: "https://github.com/city96/ComfyUI-GGUF.git", dir: "ComfyUI-GGUF", commit: "6ea2651e7df66d7585f6ffee804b20e92fb38b8a" },
    { url: "https://github.com/kijai/ComfyUI-KJNodes.git", dir: "ComfyUI-KJNodes", commit: "6ab7e8130e449ed2c0037589bcf84146ceb7fc9c" },
    { url: "https://github.com/evanspearman/ComfyMath.git", dir: "ComfyMath", commit: "c01177221c31b8e5fbc062778fc8254aeb541638" },
    { url: "https://github.com/WhatDreamscost/WhatDreamsCost-ComfyUI.git", dir: "WhatDreamsCost-ComfyUI", commit: "a3c809c8b593a74c2ddcd6c1f83ad85ebebe3c64" },
    { url: "https://github.com/Fannovel16/comfyui_controlnet_aux.git", dir: "comfyui_controlnet_aux", commit: "e8b689a513c3e6b63edc44066560ca5919c0576e" },
    { url: "https://github.com/ltdrdata/ComfyUI-Impact-Pack.git", dir: "ComfyUI-Impact-Pack", commit: "429d0159ad429e64d2b3916e6e7be9c22d025c3c" },
    { url: "https://github.com/ltdrdata/ComfyUI-Impact-Subpack.git", dir: "ComfyUI-Impact-Subpack", commit: "50c7b71a6a224734cc9b21963c6d1926816a97f1" },
    { url: "https://github.com/ssitu/ComfyUI_UltimateSDUpscale.git", dir: "ComfyUI_UltimateSDUpscale", commit: "a5547db9e1d07d3318bb21e9e9c474f4c1e9c8df" },
  ],
  extraPip: [
    "opencv-python==5.0.0.93",
    "gguf==0.19.0",
    "accelerate==1.14.0",
    "kornia==0.7.4",
    "onnxruntime==1.27.0",
    "scikit-image==0.26.0",
    "addict==2.4.0",
    "yacs==0.1.8",
    "omegaconf==2.3.1",
    "yapf==0.43.0",
    "ftfy==6.3.1",
    "fvcore==0.1.5.post20221221",
    "ultralytics==8.4.104",
    "dill==0.4.1",
    "piexif==1.1.3",
    "segment-anything==1.0",
  ],
} as const;

export type RuntimeNode = (typeof MANAGED_RUNTIME.nodes)[number] | typeof MANAGED_RUNTIME.manager;

/** Return true when any managed component is missing or not at its tested commit. */
export function managedRuntimeHasDrift(
  installed: Record<string, string | undefined>,
  desired: Record<string, string>,
): boolean {
  return Object.entries(desired).some(([key, commit]) => installed[key] !== commit);
}
