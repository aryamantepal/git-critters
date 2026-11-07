import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { languageColourway, LANGUAGES_COLOURWAY } from "../src/activity/colourway.ts";
import { LANGUAGE_COLOURS, topLanguages } from "../src/activity/languages.ts";
import { critters } from "../src/critters/index.ts";
import { paletteOf } from "../src/engine/critter.ts";
import { encodeGif } from "../src/engine/gif.ts";
import { DEFAULT_TRAITS } from "../src/engine/traits.ts";
import type { Traits } from "../src/engine/traits.ts";
import { assertEdgesShow, edgeColoursOf } from "./shared.ts";

// Traits change which colours the marks and the motion bring to the edge, so try a few.
const SAMPLE: Traits[] = [
  DEFAULT_TRAITS,
  { stage: 0, marks: 3, mood: "lively" },
  { stage: 3, marks: 3, mood: "resting" },
];

const repo = (language: string | null, fork = false) => ({ language, fork });

describe("topLanguages", () => {
  test("takes the two most common primary languages", () => {
    const repos = [repo("Go"), repo("Go"), repo("Go"), repo("Rust"), repo("Rust"), repo("Python")];
    assert.deepEqual(topLanguages(repos), ["Go", "Rust"]);
  });

  test("ignores forks and repos with no language", () => {
    const repos = [repo("Rust", true), repo("Rust", true), repo("Rust", true), repo(null), repo("Go")];
    assert.deepEqual(topLanguages(repos), ["Go"]);
  });

  test("skips languages with no colour in the table", () => {
    assert.deepEqual(topLanguages([repo("Brainfuck"), repo("Brainfuck"), repo("Ruby")]), ["Ruby"]);
    assert.deepEqual(topLanguages([repo("constructor")]), []);
  });

  test("breaks ties alphabetically, whatever order the repos come in", () => {
    const repos = [repo("Zig"), repo("Elm"), repo("Dart"), repo("Zig"), repo("Elm"), repo("Dart")];
    assert.deepEqual(topLanguages(repos), ["Dart", "Elm"]);
    assert.deepEqual(topLanguages([...repos].reverse()), ["Dart", "Elm"]);
  });

  test("gives nothing for no repos", () => {
    assert.deepEqual(topLanguages([]), []);
  });
});

test("the table has about forty languages, each a plain hex colour", () => {
  const names = Object.keys(LANGUAGE_COLOURS);
  assert.ok(names.length >= 35 && names.length <= 50, String(names.length));
  for (const name of names) assert.match(LANGUAGE_COLOURS[name], /^#[0-9a-fA-F]{6}$/, name);
});

function hueOf(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const d = Math.max(r, g, b) - Math.min(r, g, b);
  const hue = Math.max(r, g, b) === r ? ((g - b) / d) % 6 : Math.max(r, g, b) === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (hue * 60 + 360) % 360;
}

function hueGap(a: number, b: number): number {
  const gap = Math.abs(a - b) % 360;
  return Math.min(gap, 360 - gap);
}

for (const critter of critters) {
  describe(`${critter.name} in a person's languages`, () => {
    const base = critter.colourways[0];

    // Which colours reach the edge doesn't depend on the colourway, so find them once.
    const edgeColours = new Set<number>();
    for (const traits of SAMPLE) for (const colour of edgeColoursOf(critter, traits)) edgeColours.add(colour);

    test("it declares every colour that reaches the edge, since those are the ones kept visible", () => {
      for (const colour of edgeColours) {
        assert.ok(critter.edgeColours.includes(critter.colourNames[colour - 1]), critter.colourNames[colour - 1]);
      }
    });

    test("every language keeps the outline showing on both pages", () => {
      for (const language of Object.keys(LANGUAGE_COLOURS)) {
        for (const second of ["Python", language]) {
          const way = languageColourway(critter, [language, second]);
          try {
            assertEdgesShow(critter, paletteOf(critter, way), edgeColours);
          } catch (error) {
            throw new Error(`${language} and ${second}: ${(error as Error).message}`);
          }
        }
      }
    });

    test("is a complete colourway with its own id, and never touches the fixed colours", () => {
      const way = languageColourway(critter, ["TypeScript", "Rust"]);
      assert.equal(way.id, LANGUAGES_COLOURWAY);
      for (const name of critter.colourNames) assert.match(way.colours[name], /^#[0-9a-f]{6}$/, name);
      for (const name of critter.fixedColours) assert.equal(way.colours[name], base.colours[name], name);
    });

    test("the body takes the top language's hue and the accents the second's", () => {
      const way = languageColourway(critter, ["TypeScript", "Rust"]);
      assert.ok(hueGap(hueOf(way.colours[critter.bodyColour]), hueOf(LANGUAGE_COLOURS.TypeScript)) < 3);
      assert.ok(hueGap(hueOf(way.colours[critter.accentColours[0]]), hueOf(LANGUAGE_COLOURS.Rust)) < 3);
    });

    test("with one language, the accents take its hue too", () => {
      const way = languageColourway(critter, ["Go"]);
      assert.ok(hueGap(hueOf(way.colours[critter.accentColours[0]]), hueOf(LANGUAGE_COLOURS.Go)) < 3);
    });

    test("a grey language leaves the colours alone", () => {
      const way = languageColourway(critter, ["C"]);
      assert.deepEqual(way.colours, base.colours);
      assert.deepEqual(languageColourway(critter, []).colours, base.colours);
    });

    test("can be drawn without being listed on the critter", () => {
      const way = languageColourway(critter, ["Python", "Ruby"]);
      assert.ok(!critter.colourways.some((c) => c.id === way.id));
      assert.equal(paletteOf(critter, way).length, (critter.colourNames.length + 1) * 3);
      assert.ok(encodeGif(critter, way).length > 1000);
      assert.throws(() => paletteOf(critter, LANGUAGES_COLOURWAY), /no colourway/);
    });
  });
}
