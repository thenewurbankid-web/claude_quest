"""Tiny ComfyUI API client for the crowd atlas scripts (stdlib only)."""
import json, time, urllib.request, urllib.parse, io

HOST = "http://127.0.0.1:8188"


def _post(path, obj):
    req = urllib.request.Request(HOST + path, json.dumps(obj).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))


def run(graph, timeout=900):
    """Queue a prompt graph, wait for it, return {node_id: [PIL-ready bytes of each saved image]}."""
    pid = _post("/prompt", {"prompt": graph})["prompt_id"]
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = json.load(urllib.request.urlopen(f"{HOST}/history/{pid}"))
        if pid in h:
            st = h[pid]["status"]
            if st.get("status_str") == "error":
                raise RuntimeError(json.dumps(st)[:2000])
            out = {}
            for nid, o in h[pid]["outputs"].items():
                out[nid] = [urllib.request.urlopen(f"{HOST}/view?" + urllib.parse.urlencode(
                    {"filename": i["filename"], "subfolder": i["subfolder"], "type": i["type"]})).read() for i in o.get("images", [])]
            return out
        time.sleep(1)
    raise TimeoutError(pid)


def zimage(prompt, width, height, seed, steps=8, cutout=False, prefix="crowd"):
    """Z-Image-Turbo text to image; with cutout=True also a BiRefNet matte (saved as a second image, white = person)."""
    g = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "z_image_turbo_bf16.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "lumina2"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "4": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": 3.0}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["2", 0]}},
        "6": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["5", 0]}},
        "7": {"class_type": "EmptySD3LatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "8": {"class_type": "KSampler", "inputs": {"model": ["4", 0], "seed": seed, "steps": steps, "cfg": 1.0, "sampler_name": "euler",
              "scheduler": "simple", "positive": ["5", 0], "negative": ["6", 0], "latent_image": ["7", 0], "denoise": 1.0}},
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        "10": {"class_type": "SaveImage", "inputs": {"images": ["9", 0], "filename_prefix": prefix}},
    }
    if cutout:
        g["11"] = {"class_type": "BiRefNetRMBG", "inputs": {"image": ["9", 0], "model": "BiRefNet-general", "sensitivity": 1.0, "mask_blur": 0, "mask_offset": 0,
              "invert_output": False, "refine_foreground": True, "unload_model": False, "background": "Alpha", "background_color": "#222222"}}
        g["12"] = {"class_type": "MaskToImage", "inputs": {"mask": ["11", 1]}}
        g["13"] = {"class_type": "SaveImage", "inputs": {"images": ["12", 0], "filename_prefix": prefix + "_mask"}}
    return run(g)
