"""Create a texture-sized mobile GLB, preserving all geometry and transforms.

Run with Python + Pillow: python scripts/build-mobile-model.py
The desktop source is never overwritten. Only images larger than 2048 are changed.
"""
import copy
import io
import json
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def build():
    source = (ROOT / "ptc.glb").read_bytes()
    magic, version, length = struct.unpack_from("<4sII", source)
    assert magic == b"glTF" and version == 2 and length == len(source)
    json_length, json_type = struct.unpack_from("<II", source, 12)
    assert json_type == 0x4E4F534A
    document = json.loads(source[20:20 + json_length])
    original_document = copy.deepcopy(document)
    bin_header = 20 + json_length
    bin_length, bin_type = struct.unpack_from("<II", source, bin_header)
    assert bin_type == 0x004E4942
    binary = source[bin_header + 8:bin_header + 8 + bin_length]
    assert len(document["buffers"]) == 1

    replacements = {}
    for image in document.get("images", []):
        view_index = image["bufferView"]
        view = document["bufferViews"][view_index]
        offset = view.get("byteOffset", 0)
        data = binary[offset:offset + view["byteLength"]]
        with Image.open(io.BytesIO(data)) as decoded:
            if max(decoded.size) <= 2048:
                continue
            before = decoded.size
            # JPEG draft decoding avoids a full-resolution intermediate when supported.
            decoded.draft("RGB", (2048, 2048))
            decoded.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            if image["mimeType"] == "image/jpeg":
                decoded.convert("RGB").save(output, "JPEG", quality=90, optimize=True)
            else:
                decoded.save(output, "PNG", optimize=True)
            replacements[view_index] = output.getvalue()
            print(f"Image {view_index}: {before} -> {decoded.size}")

    rebuilt = bytearray()
    for index, view in enumerate(document["bufferViews"]):
        assert view.get("buffer", 0) == 0
        offset = view.get("byteOffset", 0)
        old_data = binary[offset:offset + view["byteLength"]]
        data = replacements.get(index, old_data)
        rebuilt.extend(b"\0" * (-len(rebuilt) % 4))
        view["byteOffset"] = len(rebuilt)
        view["byteLength"] = len(data)
        rebuilt.extend(data)
        if index not in replacements:
            assert rebuilt[view["byteOffset"]:view["byteOffset"] + len(data)] == old_data

    document["buffers"][0]["byteLength"] = len(rebuilt)
    # Geometry, material references, scene hierarchy and camera framing are identical.
    for key in ("accessors", "meshes", "nodes", "scenes", "materials", "textures", "images"):
        assert document.get(key) == original_document.get(key), key
    encoded = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    encoded += b" " * (-len(encoded) % 4)
    rebuilt.extend(b"\0" * (-len(rebuilt) % 4))
    size = 12 + 8 + len(encoded) + 8 + len(rebuilt)
    target = ROOT / "ptc-mobile.glb"
    with target.open("wb") as output:
        output.write(struct.pack("<4sII", b"glTF", 2, size))
        output.write(struct.pack("<II", len(encoded), 0x4E4F534A))
        output.write(encoded)
        output.write(struct.pack("<II", len(rebuilt), 0x004E4942))
        output.write(rebuilt)
    print(f"{target.name}: {len(source):,} -> {size:,} bytes; {len(replacements)} image(s) resized")


if __name__ == "__main__":
    build()
