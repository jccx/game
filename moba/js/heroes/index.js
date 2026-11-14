// 英雄登记表。新增英雄时在这里加一行。
import panyue from './panyue.js';
import liefeng from './liefeng.js';
import yesun from './yesun.js';
import xinglan from './xinglan.js';
import lingyu from './lingyu.js';

export const HEROES = [panyue, liefeng, yesun, xinglan, lingyu];
export const HERO_BY_ID = Object.fromEntries(HEROES.map((h) => [h.id, h]));
