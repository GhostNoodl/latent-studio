/**
 * Tested managed-runtime compatibility set. Updating this file is an explicit
 * release task: bootstrap never follows "latest" branches or unpinned wheels.
 */
export const MANAGED_RUNTIME = {
  comfy: {
    // Music 3 landed in v0.33.0; this follow-up fixes inference when ComfyUI is
    // not using dynamic VRAM. Windows still bootstraps from the last published
    // portable archive, then advances the bundled checkout to this exact commit.
    tag: "v0.33.0",
    commit: "03fa4e48ba524173736bf299ee0f981fc57c7414",
    windowsBaseTag: "v0.32.0",
    windows: {
      amd: {
        asset: "ComfyUI_windows_portable_amd.7z",
        sizeBytes: 1_802_964_985,
        sha256: "ad2346d0f683fbe566061a247a8461e845e7dace4ea45859a2525f73fee4a816",
      },
      intel: {
        asset: "ComfyUI_windows_portable_intel.7z",
        sizeBytes: 1_719_789_666,
        sha256: "f9635f142cc5d714eee39b65b9a8c50f2548e172ec6fbd723cd447cdd3292479",
      },
      nvidia: {
        asset: "ComfyUI_windows_portable_nvidia.7z",
        sizeBytes: 2_132_254_184,
        sha256: "642ba5e91c5f6310b11797acf79484d2248df5e09c6bb27696a25c99e68bdb72",
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
