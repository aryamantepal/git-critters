import type { Critter } from "../engine/critter.ts";
import { axolotl } from "./axolotl.ts";
import { cat } from "./cat.ts";
import { dragon } from "./dragon.ts";
import { frog } from "./frog.ts";
import { ghost } from "./ghost.ts";
import { jellyfish } from "./jellyfish.ts";
import { robot } from "./robot.ts";

/** Every critter people can pick. To add one, write its file and list it here. */
export const critters: readonly Critter[] = [dragon, axolotl, jellyfish, ghost, robot, cat, frog];

export function findCritter(id: string): Critter | undefined {
  return critters.find((critter) => critter.id === id);
}
