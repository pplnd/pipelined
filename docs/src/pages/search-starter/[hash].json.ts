import type { APIRoute, GetStaticPaths } from "astro";
import { starterSearchHash, starterSearchJson } from "../../searchStarter";

export const getStaticPaths: GetStaticPaths = () => [{ params: { hash: starterSearchHash } }];

export const GET: APIRoute = () =>
	new Response(starterSearchJson, { headers: { "Content-Type": "application/json; charset=utf-8" } });
