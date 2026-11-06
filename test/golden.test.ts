// Someone's committed GIF should only change when they ask for a different critter.
// These are the SHA-256 hashes of each colourway's GIF from before traits existed,
// so with the default traits the art has to stay byte for byte the same.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { critters } from "../src/critters/index.ts";
import { encodeGif } from "../src/engine/gif.ts";
import { DEFAULT_TRAITS } from "../src/engine/traits.ts";

const HASHES: Record<string, string> = {
  "dragon/ember": "433b58646e998a461c14c658bb8a29df37dc6a76989d96ec4401084f23af0552",
  "dragon/frost": "9dd63ad6716b078f46b1c74e2d42ee31e2fd85851a259f679d6236b415c4bbda",
  "dragon/moss": "762fc2f4f39522cc9e95557da36945222a2705fca5308bb66aa5fab3b71e3c1c",
  "axolotl/blossom": "c73f7475b44873b9440607cf10a53d7a92c71e2417cf8d589381aa5f40a683c0",
  "axolotl/gold": "47fab38de9438c9f3fa800338fdd650195558a419a9b99e17e412778a6a69369",
  "axolotl/dusk": "69c0ac2b616e530c0bb4705612eb1d3b96ab1646f5c81054c81309559e53e6c1",
  "jellyfish/lagoon": "6f08508757e9fdab32fc95a6e9e04c699ba8955d5ea768b4fc7f07b1004909eb",
  "jellyfish/orchid": "e08a2e5ac2744235c32fd440dcc10ecd14b1e864ede19d452fcdac17cc263fb9",
  "jellyfish/coral": "59e99c6ce63c07ec52d79380618f539e0d12b1dfe4d89afd710f2f18be9a30a6",
  "ghost/moon": "7049a2fe84fae6977748be7934dcc79c0e2d679df30ea5a30eb04e95de577c39",
  "ghost/mint": "4cfa190d4cc56cacbdae96a815850e52cb575874aee875656deb12d0e40318c8",
  "ghost/peach": "cb7d5fe3570e0fb54ad63c861d1e05696719a6f3f455b715fd926429940590c9",
};

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("every colourway's GIF with the default traits is byte for byte what it was before traits", () => {
  const found: Record<string, string> = {};
  for (const critter of critters) {
    for (const way of critter.colourways) found[`${critter.id}/${way.id}`] = hash(encodeGif(critter, way.id));
  }
  assert.deepEqual(found, HASHES);
});

test("asking for the default traits explicitly changes nothing", () => {
  for (const critter of critters) {
    const way = critter.colourways[0].id;
    assert.equal(hash(encodeGif(critter, way, { ...DEFAULT_TRAITS })), HASHES[`${critter.id}/${way}`]);
  }
});
