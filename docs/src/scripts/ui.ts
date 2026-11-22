import type { SearchEntry } from "../nav";
import { PplndPmTabs } from "./pmTabs";

const searchPageSize = 40;

interface SearchIndex {
	entries?: readonly SearchEntry[];
	loading?: boolean;
	failed?: boolean;
}

function rankEntry(entry: SearchEntry, needle: string): number {
	const label = entry.label.toLowerCase();
	const short = (label.split(".").pop() || label).replace(/\(\)$/u, "");
	if (label === needle) {
		return entry.meta ? 0.5 : 0;
	}
	if (short === needle) {
		return 1;
	}
	if (label.startsWith(needle)) {
		return 2;
	}
	if (label.split(".").some((part) => part.startsWith(needle))) {
		return 3;
	}
	if (label.includes(needle)) {
		return 4;
	}
	if ((entry.meta || entry.section).toLowerCase().includes(needle)) {
		return 5;
	}
	return 6;
}

function isPrimaryClick(event: MouseEvent): boolean {
	return (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey
		&& !event.altKey);
}

class PplndSearch extends HTMLElement {
	private abort: AbortController | null = null;
	private readonly starterIndex: SearchIndex = {};
	private readonly fullIndex: SearchIndex = {};
	private query = "";
	private matchingEntries: readonly SearchEntry[] = [];
	private resultLimit = searchPageSize;
	private dialog: HTMLDialogElement | null = null;
	private input: HTMLInputElement | null = null;
	private clearBtn: HTMLButtonElement | null = null;
	private countEl: HTMLElement | null = null;
	private resultsEl: HTMLUListElement | null = null;
	private moreBtn: HTMLButtonElement | null = null;
	private noResultsEl: HTMLElement | null = null;
	private itemTpl: HTMLTemplateElement | null = null;

	get isOpen(): boolean {
		return Boolean(this.dialog?.open);
	}

	connectedCallback(): void {
		this.abort?.abort();
		this.abort = new AbortController();
		const { signal } = this.abort;

		this.dialog = this.querySelector<HTMLDialogElement>(".search-dialog");
		this.input = this.querySelector<HTMLInputElement>("#module-query");
		this.clearBtn = this.querySelector<HTMLButtonElement>("#search-clear");
		this.countEl = this.querySelector<HTMLElement>("#search-count");
		this.resultsEl = this.querySelector<HTMLUListElement>(".search-results");
		this.moreBtn = this.querySelector<HTMLButtonElement>(".search-more");
		this.noResultsEl = this.querySelector<HTMLElement>(".no-results");
		this.itemTpl = this.querySelector<HTMLTemplateElement>("[data-search-item-tpl]");

		this.input?.addEventListener("input", () => this.updateQuery(), { signal });
		this.querySelector(".search-form")?.addEventListener("submit", (event) => {
			event.preventDefault();
			this.updateQuery();
		}, { signal });
		this.moreBtn?.addEventListener("click", () => {
			this.resultLimit += searchPageSize;
			this.renderResults(true);
		}, { signal });
		this.clearBtn?.addEventListener("click", (event) => {
			event.preventDefault();
			if (!this.input) {
				return;
			}
			this.input.value = "";
			this.updateQuery();
			this.input.focus();
		}, { signal });
		this.dialog?.addEventListener("close", () => this.syncSearchUrl(false), { signal });
		this.resultsEl?.addEventListener("click", (event) => {
			if (!isPrimaryClick(event)) {
				return;
			}
			const link = event.target instanceof Element ? event.target.closest("a.search-item") : null;
			if (link && this.dialog?.open) {
				this.dialog.close();
			}
		}, { signal });

		const initialParams = new URLSearchParams(location.search);
		if (initialParams.has("search")) {
			this.open(initialParams.get("search") || "");
		}
	}

	disconnectedCallback(): void {
		this.abort?.abort();
		this.abort = null;
	}

	open(initialQuery = ""): void {
		if (!this.dialog || !this.input) {
			return;
		}
		this.input.value = initialQuery;
		if (!this.dialog.open) {
			this.dialog.showModal();
		}
		this.resultLimit = searchPageSize;
		this.updateQuery();
		this.input.focus();
	}

	warmStarter(): void {
		void this.loadIndex(this.starterIndex, this.dataset.starterIndex);
	}

	private async loadIndex(index: SearchIndex, url: string | undefined): Promise<void> {
		if (!url || index.entries || index.loading) {
			return;
		}
		index.loading = true;
		index.failed = false;
		try {
			const response = await fetch(url);
			if (response.ok) {
				const entries: unknown = await response.json();
				if (Array.isArray(entries)) {
					index.entries = entries as SearchEntry[];
				}
			}
		} catch {
			// The next search attempt can retry the request.
		}
		index.loading = false;
		index.failed = !index.entries;
		if (this.isConnected && this.isOpen && (index === this.fullIndex || !this.query || !this.fullIndex.entries)) {
			this.filterModules();
		}
	}

	private updateQuery(): void {
		if (!this.input) {
			return;
		}
		const query = this.input.value.trim().toLowerCase();
		if (this.query !== query) {
			this.query = query;
			this.resultLimit = searchPageSize;
		}
		this.warmStarter();
		if (query) {
			void this.loadIndex(this.fullIndex, "/search-index.json");
		}
		this.filterModules();
		this.syncSearchUrl(true);
	}

	private syncSearchUrl(open: boolean): void {
		if (!this.input) {
			return;
		}
		const url = new URL(location.href);
		if (open) {
			url.searchParams.set("search", this.input.value.trim());
		} else {
			url.searchParams.delete("search");
		}
		const qs = url.searchParams.toString();
		history.replaceState(null, "", url.pathname + (qs ? `?${qs}` : "") + url.hash);
	}

	private createResultNode(entry: SearchEntry): Node {
		if (this.itemTpl) {
			const fragment = this.itemTpl.content.cloneNode(true) as DocumentFragment;
			const link = fragment.querySelector<HTMLAnchorElement>("a.search-item");
			const meta = fragment.querySelector<HTMLElement>(".search-item-meta");
			const title = fragment.querySelector<HTMLElement>(".search-item-title");
			if (link) {
				link.href = entry.href;
			}
			if (meta) {
				meta.textContent = entry.meta || entry.section;
			}
			if (title) {
				title.textContent = entry.label;
			}
			return fragment;
		}
		const item = document.createElement("li");
		const link = document.createElement("a");
		link.className = "search-item";
		link.href = entry.href;
		const meta = document.createElement("span");
		meta.className = "search-item-meta";
		meta.textContent = entry.meta || entry.section;
		const title = document.createElement("span");
		title.className = "search-item-title";
		title.textContent = entry.label;
		link.append(meta, title);
		item.append(link);
		return item;
	}

	private filterModules(): void {
		const needle = this.query;
		const entries = (needle ? this.fullIndex.entries : undefined) ?? this.starterIndex.entries ?? [];
		const matches = entries.filter((entry) =>
			!needle
			|| entry.label.toLowerCase().includes(needle)
			|| entry.section.toLowerCase().includes(needle)
			|| (entry.meta && entry.meta.toLowerCase().includes(needle))
			|| (entry.desc && entry.desc.toLowerCase().includes(needle))
		);
		if (needle) {
			matches.sort((a, b) => rankEntry(a, needle) - rankEntry(b, needle));
		}
		this.matchingEntries = matches;
		this.renderResults();
	}

	private renderResults(append = false): void {
		if (!this.resultsEl || !this.noResultsEl) {
			return;
		}
		const start = append ? this.resultsEl.childElementCount : 0;
		const nodes = this.matchingEntries.slice(start, this.resultLimit).map((entry) => this.createResultNode(entry));
		const restoreFocus = append && document.activeElement === this.moreBtn;
		if (append) {
			this.resultsEl.append(...nodes);
		} else {
			const active = document.activeElement;
			const focusedHref = active instanceof HTMLAnchorElement && this.resultsEl.contains(active) ? active.href : null;
			this.resultsEl.replaceChildren(...nodes);
			if (focusedHref) {
				const replacement = [...this.resultsEl.querySelectorAll("a")].find((link) => link.href === focusedHref);
				(replacement ?? this.input)?.focus({ preventScroll: true });
			}
		}
		if (restoreFocus) {
			this.resultsEl.children[start]?.querySelector("a")?.focus();
		}

		const index = this.query ? this.fullIndex : this.starterIndex;
		const hasMore = this.matchingEntries.length > this.resultLimit;
		if (this.moreBtn) {
			this.moreBtn.hidden = !hasMore;
		}
		if (this.clearBtn) {
			this.clearBtn.hidden = !this.input?.value.length;
		}
		if (this.countEl) {
			const summary = hasMore
				? `Results: ${this.matchingEntries.length} (showing ${this.resultLimit})`
				: `Results: ${this.matchingEntries.length}`;
			let status = "";
			if (index.loading) {
				status = this.query ? "Searching all documentation…" : "Loading search…";
			} else if (index.failed) {
				status = this.query ? "Full search is unavailable." : "Search is unavailable.";
			}
			this.countEl.textContent = status && this.matchingEntries.length ? `${status} ${summary}` : status || summary;
		}
		this.noResultsEl.hidden = !index.entries || this.matchingEntries.length !== 0;
	}
}

function deferFooterLogo(): void {
	const footer = document.querySelector(".foot");
	if (!footer) {
		return;
	}
	const motion = matchMedia("(prefers-reduced-motion: no-preference)");
	const controller = new AbortController();
	const observer = new IntersectionObserver(([entry], currentObserver) => {
		if (!entry?.isIntersecting || !motion.matches) {
			return;
		}
		currentObserver.disconnect();
		controller.abort();
		void import("./footerLogo").then(({ initFooterLogo }) => initFooterLogo()).catch(() => {});
	}, { rootMargin: "160px 0px" });
	const syncObservation = (): void => {
		if (motion.matches) {
			observer.observe(footer);
		} else {
			observer.disconnect();
		}
	};
	motion.addEventListener("change", syncObservation, { signal: controller.signal });
	syncObservation();
}

function initShell(): void {
	const searchEl = document.querySelector<PplndSearch>("pplnd-search");
	for (const trigger of document.querySelectorAll<HTMLButtonElement>(".search")) {
		const warmSearch = (): void => searchEl?.warmStarter();
		trigger.addEventListener("pointerenter", warmSearch);
		trigger.addEventListener("focus", warmSearch);
		trigger.addEventListener("click", () => searchEl?.open(""));
	}

	const menu = document.querySelector<HTMLButtonElement>(".menu-toggle");
	let pageScrollTop = 0;
	function setMenu(open: boolean): void {
		if (!menu || open === document.body.classList.contains("menu-open")) {
			return;
		}
		if (open) {
			pageScrollTop = window.scrollY;
		}
		document.body.classList.toggle("menu-open", open);
		menu.setAttribute("aria-expanded", String(open));
		menu.textContent = open ? "Close" : "Menu";
		window.scrollTo({ top: open ? 0 : pageScrollTop, behavior: "instant" });
	}
	if (menu) {
		menu.addEventListener("click", () => setMenu(menu.getAttribute("aria-expanded") === "false"));
		matchMedia("(min-width: 768px)").addEventListener("change", () => setMenu(false));
		document.addEventListener("keydown", (event) => {
			if (event.key === "Escape" && !searchEl?.isOpen && document.body.classList.contains("menu-open")) {
				setMenu(false);
				menu.focus({ preventScroll: true });
			}
		});
	}

	for (const trigger of document.querySelectorAll<HTMLButtonElement>("[data-panel]")) {
		trigger.addEventListener("click", () => {
			const open = trigger.getAttribute("aria-expanded") === "false";
			const panel = document.getElementById(trigger.dataset.panel || "");
			if (panel) {
				panel.inert = !open;
			}
			trigger.setAttribute("aria-expanded", String(open));
		});
	}

	const themeBtn = document.querySelector<HTMLButtonElement>("#theme");
	let themeSwitchRaf: number | null = null;
	let themeSwitchRaf2: number | null = null;
	function syncThemeLabel(): void {
		if (!themeBtn) {
			return;
		}
		const isDark = document.documentElement.dataset.theme === "dark";
		themeBtn.textContent = `Dark mode: ${isDark ? "On" : "Off"}`;
		themeBtn.setAttribute("aria-pressed", String(isDark));
	}
	syncThemeLabel();
	themeBtn?.addEventListener("click", () => {
		const root = document.documentElement;
		if (themeSwitchRaf !== null) {
			cancelAnimationFrame(themeSwitchRaf);
			themeSwitchRaf = null;
		}
		if (themeSwitchRaf2 !== null) {
			cancelAnimationFrame(themeSwitchRaf2);
			themeSwitchRaf2 = null;
		}
		root.classList.add("theme-switching");
		root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
		syncThemeLabel();
		themeSwitchRaf = requestAnimationFrame(() => {
			themeSwitchRaf = null;
			themeSwitchRaf2 = requestAnimationFrame(() => {
				themeSwitchRaf2 = null;
				root.classList.remove("theme-switching");
			});
		});
		try {
			localStorage.setItem("pplnd-theme", root.dataset.theme);
		} catch {}
	});

	const leftSticky = document.querySelector<HTMLElement>(".left-sticky");
	const leftNav = document.querySelector<HTMLElement>(".left nav");
	const heroBrand = document.querySelector<HTMLElement>(".hero-brand");
	const header = document.querySelector<HTMLElement>(".head");
	const goUpWrap = document.querySelector<HTMLElement>(".go-up-wrap");
	const goUpBtn = document.querySelector<HTMLButtonElement>(".go-up");

	if (header && heroBrand) {
		new IntersectionObserver(([entry]) => {
			if (entry && entry.boundingClientRect.height > 0) {
				header.classList.toggle("is-stuck", !entry.isIntersecting && entry.boundingClientRect.bottom <= 0);
			}
		}).observe(heroBrand);
	}

	if (leftSticky && leftNav && goUpWrap && goUpBtn) {
		const setStuck = (stuck: boolean): void => {
			leftSticky.classList.toggle("is-stuck", stuck);
			goUpWrap.inert = !stuck;
		};
		new IntersectionObserver(([entry]) => {
			if (entry) {
				setStuck(!entry.isIntersecting && entry.boundingClientRect.bottom <= 16);
			}
		}, { rootMargin: "-16px 0px 0px 0px" }).observe(leftNav);

		goUpWrap.addEventListener("focusout", (event) => {
			if (goUpWrap.inert && !event.relatedTarget) {
				const fallback = heroBrand?.querySelector<HTMLElement>("a") || header?.querySelector<HTMLButtonElement>(".search");
				fallback?.focus({ preventScroll: true });
			}
		});

		goUpBtn.addEventListener("click", () => {
			const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
			window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
		});
	}

	const notFoundPath = document.querySelector<SVGTextElement>("#not-found-path");
	const notFoundSearchBtn = document.querySelector<HTMLButtonElement>("#not-found-search-btn");
	if (notFoundPath || notFoundSearchBtn) {
		const rawPath = location.pathname;
		if (notFoundPath) {
			notFoundPath.textContent = rawPath.length > 34 ? `${rawPath.slice(0, 31)}...` : rawPath;
		}
		const slug = (rawPath.split("/").filter(Boolean).pop() || "").replace(/[-_]+/gu, " ").trim();
		notFoundSearchBtn?.addEventListener("click", () => searchEl?.open(slug));
	}

	deferFooterLogo();
}

if (!customElements.get("pplnd-pm-tabs")) {
	customElements.define("pplnd-pm-tabs", PplndPmTabs);
}
if (!customElements.get("pplnd-search")) {
	customElements.define("pplnd-search", PplndSearch);
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initShell, { once: true });
} else {
	initShell();
}
