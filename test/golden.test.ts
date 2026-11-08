// Someone's committed GIF should only change when they ask for a different critter.
// These are the SHA-256 hashes of each colourway's GIF with the default traits,
// taken before traits existed (the dragon's after its redesign), so the art has to
// stay byte for byte the same.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { critters } from "../src/critters/index.ts";
import { encodeGif } from "../src/engine/gif.ts";
import { DEFAULT_TRAITS } from "../src/engine/traits.ts";

const HASHES: Record<string, string> = {
  "dragon/ember": "3374d22046e22b41b78b6511c32c23078e1f05553acdcbf9db5636086c6f0d6a",
  "dragon/frost": "221d01a57ea1dcceb70ec3248679743bba7763594efa1b59989938245c8a9a8a",
  "dragon/moss": "7cbdad55634c3da3a00abdfbbff5d916f2d8319dc0f5252933327e8162474f28",
  "axolotl/blossom": "c73f7475b44873b9440607cf10a53d7a92c71e2417cf8d589381aa5f40a683c0",
  "axolotl/gold": "47fab38de9438c9f3fa800338fdd650195558a419a9b99e17e412778a6a69369",
  "axolotl/dusk": "69c0ac2b616e530c0bb4705612eb1d3b96ab1646f5c81054c81309559e53e6c1",
  "jellyfish/lagoon": "6f08508757e9fdab32fc95a6e9e04c699ba8955d5ea768b4fc7f07b1004909eb",
  "jellyfish/orchid": "e08a2e5ac2744235c32fd440dcc10ecd14b1e864ede19d452fcdac17cc263fb9",
  "jellyfish/coral": "59e99c6ce63c07ec52d79380618f539e0d12b1dfe4d89afd710f2f18be9a30a6",
  "ghost/moon": "7049a2fe84fae6977748be7934dcc79c0e2d679df30ea5a30eb04e95de577c39",
  "ghost/mint": "4cfa190d4cc56cacbdae96a815850e52cb575874aee875656deb12d0e40318c8",
  "ghost/peach": "cb7d5fe3570e0fb54ad63c861d1e05696719a6f3f455b715fd926429940590c9",
  "robot/cobalt": "df52dc0e3afdb1b76d525408ebf5ae7817a9baa358169b3b7efa60c098c08c8f",
  "robot/copper": "2b5744bb0d52f09255de93511a2e4d2a29f186fda1c743c77707dbd9b23bc974",
  "robot/lemon": "4194a214a093c11d30795041e00e8b9448a16e4c46adcb509ea5baae2d2a4271",
  "cat/marmalade": "622221cc5ed9237436ffa9be91feb19bf2f9dc7a7360c43a99c014eceb66dea2",
  "cat/smoke": "49bbc9ea402e657e39a6ecefdfeb6dc80d103dfce1cf93158d27a2d75eccd468",
  "cat/tuxedo": "eabdc3ca1bc60d9203e468c5b85eba477d9d7d277dc29d77cc4cd79352b504d3",
  "frog/meadow": "a129d3f5aed0de030f298e2af9c62aeab3831df40f00493f09653cbe494616ed",
  "frog/cobalt": "fff5268caaa9187c5852a683f22f93a87d48f7642123ebf5b42a7c0049da6e5c",
  "frog/tomato": "6a15a0230b225daded370155c74c6a820d5a53963ba9cc6f8e75817db4836055",
  "mushroom/umber": "4957617c27eb2ebf37221f5ddd1fb604cb66febdbc5a3372ba67eb24d973c3bf",
  "mushroom/glowcap": "cf83dcdf98c6afedfca49ac795a9be6d8b15bd8f8b98f149cb32d7f60a1896a1",
  "mushroom/amethyst": "c48f433d5f604bb38d5fc482753811276eb76f3ae1d676d7e3c782ef45941f59",
  "turtle/pond": "4a0c3f8ee6bf91f5a7ca0c02fd523761462f729fe9c64bb4381d173e94f12b06",
  "turtle/honey": "8828e78bb2b31c7daf2eaaa7fda5ae9e0044c408165611e125c31068ac8c777d",
  "turtle/blueberry": "966596302fab50f4fb81112382face853014c3d7ecd34aee0c79ff4ff96ce910",
  "bat/dusk": "87963fa6c07353d769d7d32e6ea30008f0f8083d97c73966846d421b003b8d29",
  "bat/cocoa": "6ea2a1cafcc8e25c8124bc7e4b82857f46acca0b97bb4e432bc42f06a95fc789",
  "bat/mist": "d1587629cfa63f5e818e87488455cbb3f53029229966c648a3250b4f9288704d",
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
