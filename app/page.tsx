"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { Marker, type MapRef } from "react-map-gl/maplibre";
import type { User } from "@supabase/supabase-js";
import { COUNTRIES } from "@/lib/geo";
import { reverseGeocode, searchPlaces, type NominatimResult } from "@/lib/nominatim";
import { createClient } from "@/lib/supabase/client";
import type { Profile, PlaceEntry } from "@/lib/types";

type Tab = "world" | "country";
type IncomingRequest = { id: number; sender_id: string; sender: Profile[] | Profile | null };

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const missingSupabaseEnv =
  !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const WORLD_VIEW = { center: [10, 20] as [number, number], zoom: 1.3 };

const DEMO_REQUEST: IncomingRequest = {
  id: -1,
  sender_id: "demo",
  sender: {
    id: "demo",
    handle: "alex_wanders",
    display_name: "Alex Wanders",
    description: "Solo traveler · 47 countries · always chasing sunsets.",
  },
};

// ── Tiny helpers ──────────────────────────────────────────────────

function Avatar({ name, className = "" }: { name: string; className?: string }) {
  const letters = name
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      className={`flex flex-shrink-0 items-center justify-center rounded-full font-bold text-white ${className}`}
      style={{ background: "linear-gradient(135deg,#06b6d4,#6366f1)" }}
    >
      {letters}
    </div>
  );
}

function Pill({
  children,
  onRemove,
}: {
  children: React.ReactNode;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-0.5 text-xs font-medium text-cyan-300">
      {children}
      {onRemove ? (
        <button
          onClick={onRemove}
          className="ml-0.5 text-cyan-600 transition-colors hover:text-white"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

const CARD = "rounded-2xl border border-white/[0.07] bg-white/[0.04] backdrop-blur-xl";
const INPUT =
  "w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/60";
const BTN_GHOST =
  "rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/[0.09] hover:text-white";
const BTN_PRIMARY =
  "rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition-opacity hover:opacity-90";

// ── Main component ────────────────────────────────────────────────

export default function Home() {
  const supabase = useMemo(() => createClient(), []);
  const mapRef = useRef<MapRef>(null);

  const [email, setEmail] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [info, setInfo] = useState("");

  const [tab, setTab] = useState<Tab>("world");
  const [countryCode, setCountryCode] = useState("IN");
  const [worldPlaces, setWorldPlaces] = useState<PlaceEntry[]>([]);
  const [countryPlaces, setCountryPlaces] = useState<PlaceEntry[]>([]);
  const [allCountryRows, setAllCountryRows] = useState<PlaceEntry[]>([]);
  const [geocoding, setGeocoding] = useState(false);

  const [placeQuery, setPlaceQuery] = useState("");
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const [search, setSearch] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [canViewSelected, setCanViewSelected] = useState(false);
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [showDemoRequest, setShowDemoRequest] = useState(false);

  const isOwnView = selectedProfile ? selectedProfile.id === user?.id : true;
  const mapLocked = Boolean(selectedProfile && !isOwnView && !canViewSelected);
  const activePlaces = tab === "world" ? worldPlaces : countryPlaces;

  // ── Data ──────────────────────────────────────────────────────────

  const loadCoverage = useCallback(
    async (ownerId: string) => {
      const [{ data: world }, { data: country }] = await Promise.all([
        supabase.from("coverage_world").select("country_code,place_name,lat,lng").eq("user_id", ownerId),
        supabase.from("coverage_country").select("country_code,place_name,lat,lng").eq("user_id", ownerId),
      ]);
      setWorldPlaces(
        (world ?? []).filter((r) => r.lat != null).map((r) => ({
          country_code: r.country_code,
          place_name: r.place_name,
          lat: r.lat,
          lng: r.lng,
        })),
      );
      setAllCountryRows(
        (country ?? []).filter((r) => r.lat != null).map((r) => ({
          country_code: r.country_code,
          place_name: r.place_name,
          lat: r.lat,
          lng: r.lng,
        })),
      );
    },
    [supabase],
  );

  useEffect(() => {
    setCountryPlaces(allCountryRows.filter((r) => r.country_code === countryCode));
  }, [allCountryRows, countryCode]);

  const loadIncoming = useCallback(
    async (userId: string) => {
      const { data, error } = await supabase
        .from("connections")
        .select("id,sender_id,sender:profiles!connections_sender_id_fkey(id,handle,display_name,description)")
        .eq("receiver_id", userId)
        .eq("status", "pending");
      if (!error) setIncoming((data as IncomingRequest[]) ?? []);
    },
    [supabase],
  );

  useEffect(() => {
    const boot = async () => {
      const { data } = await supabase.auth.getUser();
      const loggedUser = data.user ?? null;
      setUser(loggedUser);
      if (!loggedUser) return;
      const { data: existing } = await supabase
        .from("profiles")
        .select("id,handle,display_name,description")
        .eq("id", loggedUser.id)
        .single();
      if (!existing) {
        const h = loggedUser.email?.split("@")[0] ?? `traveler_${loggedUser.id.slice(0, 6)}`;
        await supabase.from("profiles").insert({
          id: loggedUser.id,
          handle: h,
          display_name: h,
          description: "Traveling the world one place at a time.",
        });
      }
      const { data: me } = await supabase
        .from("profiles")
        .select("id,handle,display_name,description")
        .eq("id", loggedUser.id)
        .single();
      setProfile(me as Profile);
      await loadCoverage(loggedUser.id);
      await loadIncoming(loggedUser.id);
    };
    void boot();
  }, [loadCoverage, loadIncoming, supabase]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (tab === "country") {
      const c = COUNTRIES.find((c) => c.code === countryCode);
      if (c) mapRef.current.flyTo({ center: [c.lng, c.lat], zoom: 4, duration: 1200 });
    } else {
      mapRef.current.flyTo({ ...WORLD_VIEW, duration: 1200 });
    }
  }, [tab, countryCode]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node))
        setSuggestions([]);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Map interactions ──────────────────────────────────────────────

  function resetMapView() {
    if (!mapRef.current) return;
    if (tab === "country") {
      const c = COUNTRIES.find((c) => c.code === countryCode);
      if (c) mapRef.current.flyTo({ center: [c.lng, c.lat], zoom: 4, duration: 800 });
    } else {
      mapRef.current.flyTo({ ...WORLD_VIEW, duration: 800 });
    }
  }

  async function handleMapClick(lat: number, lng: number) {
    if (!isOwnView || mapLocked) return;
    setGeocoding(true);
    const result = await reverseGeocode(lat, lng);
    setGeocoding(false);
    if (!result) return;
    if (tab === "world") {
      const name = result.address.country;
      const iso = (result.address.country_code ?? "").toUpperCase();
      if (!name || !iso) return;
      const known = COUNTRIES.find((c) => c.code === iso);
      const entry: PlaceEntry = { country_code: iso, place_name: name, lat: known?.lat ?? lat, lng: known?.lng ?? lng };
      setWorldPlaces((prev) => (prev.some((p) => p.country_code === iso) ? prev : [...prev, entry]));
    } else {
      const a = result.address;
      const name = a.city ?? a.town ?? a.village ?? a.suburb ?? a.county ?? a.state_district ?? a.state ?? result.display_name.split(",")[0];
      if (!name) return;
      setCountryPlaces((prev) => (prev.some((p) => p.place_name === name) ? prev : [...prev, { country_code: countryCode, place_name: name, lat, lng }]));
    }
  }

  // ── Autocomplete ──────────────────────────────────────────────────

  function handlePlaceInput(value: string) {
    setPlaceQuery(value);
    setSuggestions([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) return;
    debounceRef.current = setTimeout(async () => {
      setLoadingPlaces(true);
      setSuggestions(await searchPlaces(value, tab === "country" ? countryCode : undefined));
      setLoadingPlaces(false);
    }, 400);
  }

  function addPlace(result: NominatimResult) {
    const parts = result.display_name.split(", ");
    const placeName = parts.slice(0, 2).join(", ");
    const entry: PlaceEntry = {
      country_code: (result.address.country_code ?? countryCode).toUpperCase(),
      place_name: placeName,
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
    };
    if (tab === "world") {
      setWorldPlaces((prev) => (prev.some((p) => p.place_name === placeName) ? prev : [...prev, entry]));
    } else {
      setCountryPlaces((prev) => (prev.some((p) => p.place_name === placeName) ? prev : [...prev, { ...entry, country_code: countryCode }]));
    }
    setPlaceQuery("");
    setSuggestions([]);
  }

  // ── Save ──────────────────────────────────────────────────────────

  async function saveCoverage() {
    if (!user) return;
    await supabase.from("coverage_world").delete().eq("user_id", user.id);
    if (worldPlaces.length > 0)
      await supabase.from("coverage_world").insert(worldPlaces.map((p) => ({ user_id: user.id, country_code: p.country_code, place_name: p.place_name, lat: p.lat, lng: p.lng })));
    await supabase.from("coverage_country").delete().eq("user_id", user.id).eq("country_code", countryCode);
    if (countryPlaces.length > 0)
      await supabase.from("coverage_country").insert(countryPlaces.map((p) => ({ user_id: user.id, country_code: countryCode, place_name: p.place_name, lat: p.lat, lng: p.lng })));
    const { data } = await supabase.from("coverage_country").select("country_code,place_name,lat,lng").eq("user_id", user.id);
    setAllCountryRows((data ?? []).filter((r) => r.lat != null).map((r) => ({ country_code: r.country_code, place_name: r.place_name, lat: r.lat, lng: r.lng })));
    setInfo("Coverage saved ✓");
    setTimeout(() => setInfo(""), 3000);
  }

  // ── Auth ──────────────────────────────────────────────────────────

  async function sendMagicLink() {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    setInfo(error ? error.message : "Magic link sent — check your inbox.");
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  // ── Social ────────────────────────────────────────────────────────

  async function searchProfiles() {
    if (!search.trim()) return;
    const { data } = await supabase.from("profiles").select("id,handle,display_name,description").or(`display_name.ilike.%${search}%,handle.ilike.%${search}%`).limit(8);
    setProfiles((data as Profile[]) ?? []);
  }

  async function selectProfile(p: Profile) {
    setSelectedProfile(p);
    setProfiles([]);
    setSearch("");
    if (!user) return;
    const { data } = await supabase.from("connections").select("id").eq("sender_id", p.id).eq("receiver_id", user.id).eq("status", "accepted").limit(1);
    const allowed = Boolean(data && data.length > 0);
    setCanViewSelected(allowed);
    if (allowed) await loadCoverage(p.id);
  }

  function backToMyMap() {
    setSelectedProfile(null);
    setCanViewSelected(false);
    if (user) void loadCoverage(user.id);
  }

  async function shareMyMap(receiverId: string) {
    if (!user) return;
    await supabase.from("connections").upsert({ sender_id: user.id, receiver_id: receiverId, status: "pending" }, { onConflict: "sender_id,receiver_id" });
    setInfo("Share request sent ✓");
    setTimeout(() => setInfo(""), 3000);
  }

  async function respond(requestId: number, status: "accepted" | "rejected") {
    if (requestId === -1) { setShowDemoRequest(false); return; }
    await supabase.from("connections").update({ status }).eq("id", requestId);
    if (user) await loadIncoming(user.id);
  }

  function copyShareLink() {
    if (!profile) return;
    void navigator.clipboard.writeText(`${window.location.origin}?share=${profile.handle}`).then(() => {
      setInfo("Profile link copied to clipboard ✓");
      setTimeout(() => setInfo(""), 3000);
    });
  }

  // ── Render ────────────────────────────────────────────────────────

  const totalPlaces = worldPlaces.length + allCountryRows.length;

  return (
    <div
      className="min-h-screen text-slate-100"
      style={{
        background:
          "radial-gradient(circle 900px at 10% -5%, rgba(6,182,212,0.18) 0%, transparent 55%)," +
          "radial-gradient(circle 700px at 92% 10%, rgba(139,92,246,0.14) 0%, transparent 50%)," +
          "radial-gradient(circle 1100px at 50% 115%, rgba(234,88,12,0.2) 0%, transparent 52%)," +
          "#07080e",
      }}
    >
      {/* Coordinate grid */}
      <div
        className="pointer-events-none fixed inset-0 opacity-100"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.018) 1px,transparent 1px)," +
            "linear-gradient(90deg,rgba(255,255,255,0.018) 1px,transparent 1px)",
          backgroundSize: "80px 80px",
        }}
      />

      {/* ── Header ── */}
      <header className="relative mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl text-lg"
            style={{ background: "linear-gradient(135deg,rgba(6,182,212,0.25),rgba(99,102,241,0.25))", border: "1px solid rgba(6,182,212,0.3)" }}
          >
            🌍
          </div>
          <div>
            <h1
              className="text-xl font-black tracking-tight"
              style={{
                background: "linear-gradient(110deg,#fff 15%,#67e8f9 50%,#fb923c 90%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Know Your Earth Coverage
            </h1>
            <p className="text-[11px] tracking-wide text-slate-600">
              Your personal travel map · private by default
            </p>
          </div>
        </div>

        {user && profile ? (
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 sm:flex">
              <Avatar name={profile.display_name} className="h-7 w-7 text-xs" />
              <span className="text-sm text-slate-400">{profile.display_name}</span>
            </div>
            <div className="mx-2 hidden h-4 w-px bg-white/10 sm:block" />
            <button className={BTN_GHOST} onClick={copyShareLink} style={{ fontSize: 12 }}>
              Share profile
            </button>
            <button className={BTN_GHOST} onClick={logout} style={{ fontSize: 12 }}>
              Sign out
            </button>
          </div>
        ) : null}
      </header>

      {missingSupabaseEnv ? (
        <div className="relative mx-auto mb-3 w-full max-w-7xl rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-2.5 text-xs text-amber-300">
          ⚠ Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in <code>.env.local</code>
        </div>
      ) : null}

      {/* ── Sign-in screen ── */}
      {!user ? (
        <main className="relative mx-auto mt-14 flex w-full max-w-sm flex-col items-center gap-5 rounded-3xl border border-white/8 bg-white/[0.04] p-10 text-center backdrop-blur-xl">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl text-3xl"
            style={{ background: "linear-gradient(135deg,rgba(6,182,212,0.2),rgba(99,102,241,0.2))", border: "1px solid rgba(6,182,212,0.25)" }}
          >
            🌍
          </div>
          <div>
            <h2 className="text-2xl font-black text-white">Your travel map,</h2>
            <h2 className="text-2xl font-black" style={{ background: "linear-gradient(90deg,#67e8f9,#fb923c)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              beautifully private.
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Pin every country, city, and region you've visited. Share only with people you choose.
            </p>
          </div>
          <input
            className={INPUT}
            placeholder="your@email.com"
            value={email}
            type="email"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void sendMagicLink(); }}
          />
          <button className={`${BTN_PRIMARY} w-full py-3`} onClick={sendMagicLink}>
            Continue with magic link →
          </button>
          {info ? <p className="text-xs text-slate-500">{info}</p> : null}
          <p className="text-[11px] text-slate-700">No password. No tracking. Just your pins.</p>
        </main>
      ) : (
        /* ── Main app ── */
        <main className="relative mx-auto grid w-full max-w-7xl grid-cols-1 items-start gap-4 px-6 pb-10 lg:grid-cols-[280px_minmax(0,1fr)]">

          {/* ── LEFT SIDEBAR ── */}
          <aside className="flex flex-col gap-3">

            {/* Own profile card */}
            {profile && isOwnView ? (
              <div className={`${CARD} flex items-center gap-3 px-4 py-3`}>
                <Avatar name={profile.display_name} className="h-9 w-9 text-sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{profile.display_name}</p>
                  <p className="text-xs text-slate-500">@{profile.handle}</p>
                </div>
              </div>
            ) : null}

            {/* Viewing another profile */}
            {selectedProfile && !isOwnView ? (
              <div className={`${CARD} flex flex-col gap-3 p-4`}>
                <button className="flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-white" onClick={backToMyMap}>
                  ← Back to my map
                </button>
                <div className="flex items-start gap-3">
                  <Avatar name={selectedProfile.display_name} className="h-10 w-10 text-sm" />
                  <div className="min-w-0">
                    <p className="font-semibold text-white">{selectedProfile.display_name}</p>
                    <p className="text-xs text-cyan-400">@{selectedProfile.handle}</p>
                    {selectedProfile.description ? (
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">{selectedProfile.description}</p>
                    ) : null}
                  </div>
                </div>
                {canViewSelected ? (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-3 py-2 text-xs text-emerald-400">
                    ✓ Their map is shared with you
                  </div>
                ) : (
                  <div className="rounded-xl border border-white/7 bg-white/[0.03] p-3">
                    <p className="mb-2 text-xs text-slate-500">Their map is private. Share yours first — they may share back.</p>
                    <button className={`${BTN_PRIMARY} w-full py-2 text-xs`} onClick={() => void shareMyMap(selectedProfile.id)}>
                      Share my map with them
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            {/* Find Travelers */}
            {isOwnView ? (
              <div className={`${CARD} flex flex-col gap-3 p-4`}>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Find Travelers</p>
                <div className="flex gap-2">
                  <input
                    className={INPUT}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void searchProfiles(); }}
                    placeholder="Name or @handle"
                  />
                  <button className={BTN_GHOST} onClick={searchProfiles}>Go</button>
                </div>
                {profiles.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {profiles.map((p) => (
                      <div key={p.id} className="rounded-xl border border-white/6 bg-white/[0.03] p-3">
                        <div className="flex items-start gap-2.5">
                          <Avatar name={p.display_name} className="h-8 w-8 text-xs" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-white">{p.display_name}</p>
                            <p className="text-xs text-cyan-400">@{p.handle}</p>
                          </div>
                        </div>
                        <div className="mt-2.5 flex gap-2">
                          <button
                            className="flex-1 rounded-lg border border-white/10 bg-white/5 py-1.5 text-xs transition-colors hover:bg-white/10"
                            onClick={() => void selectProfile(p)}
                          >
                            View profile
                          </button>
                          {user.id !== p.id ? (
                            <button
                              className="flex-1 rounded-lg bg-cyan-700/60 py-1.5 text-xs transition-colors hover:bg-cyan-600"
                              onClick={() => void shareMyMap(p.id)}
                            >
                              Share map
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-xs text-slate-700">Search to find other travelers</p>
                )}
              </div>
            ) : null}

            {/* Incoming Requests */}
            {isOwnView ? (
              <div className={`${CARD} flex flex-col gap-3 p-4`}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                    Incoming Requests
                  </p>
                  {incoming.length > 0 ? (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                      style={{ background: "linear-gradient(135deg,#f97316,#ef4444)" }}
                    >
                      {incoming.length}
                    </span>
                  ) : null}
                </div>

                {/* Demo request */}
                {showDemoRequest ? (
                  <RequestCard
                    displayName="Alex Wanders"
                    handle="alex_wanders"
                    onAccept={() => setShowDemoRequest(false)}
                    onReject={() => setShowDemoRequest(false)}
                    isDemo
                  />
                ) : null}

                {incoming.map((req) => {
                  const sender = Array.isArray(req.sender) ? req.sender[0] : req.sender;
                  return sender ? (
                    <RequestCard
                      key={req.id}
                      displayName={sender.display_name}
                      handle={sender.handle}
                      onAccept={() => void respond(req.id, "accepted")}
                      onReject={() => void respond(req.id, "rejected")}
                    />
                  ) : null;
                })}

                {incoming.length === 0 && !showDemoRequest ? (
                  <div className="flex flex-col items-center gap-2 py-2 text-center">
                    <p className="text-xs text-slate-700">No pending requests</p>
                    <button
                      className="text-[11px] text-slate-600 underline underline-offset-2 transition-colors hover:text-slate-400"
                      onClick={() => setShowDemoRequest(true)}
                    >
                      Preview what one looks like →
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </aside>

          {/* ── RIGHT PANEL ── */}
          <section className="flex flex-col gap-3">

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: worldPlaces.length, label: "Countries", gradient: "linear-gradient(135deg,#7dd3fc,#22d3ee)", glow: "rgba(34,211,238,0.4)", border: "rgba(34,211,238,0.12)" },
                { value: allCountryRows.length, label: "Cities & regions", gradient: "linear-gradient(135deg,#fcd34d,#fb923c)", glow: "rgba(251,146,60,0.4)", border: "rgba(251,146,60,0.12)" },
                { value: totalPlaces, label: "Total pins", gradient: "linear-gradient(135deg,#c4b5fd,#a78bfa)", glow: "rgba(167,139,250,0.4)", border: "rgba(167,139,250,0.12)" },
              ].map(({ value, label, gradient, glow, border }) => (
                <div
                  key={label}
                  className="flex flex-col items-center gap-1 rounded-2xl py-4 text-center backdrop-blur-xl"
                  style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${border}`, boxShadow: value > 0 ? `inset 0 1px 0 ${border}` : "none" }}
                >
                  <p
                    className="text-4xl font-black tabular-nums leading-none"
                    style={{
                      background: gradient,
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                      filter: value > 0 ? `drop-shadow(0 0 10px ${glow})` : "none",
                    }}
                  >
                    {value}
                  </p>
                  <p className="text-[10px] font-medium uppercase tracking-widest text-slate-600">{label}</p>
                </div>
              ))}
            </div>

            {/* Controls card */}
            <div className={`${CARD} flex flex-col gap-3 p-4`}>
              {/* Tab bar + save */}
              <div className="flex items-center justify-between">
                <div className="flex gap-1.5 rounded-xl border border-white/8 bg-black/30 p-1">
                  {(["world", "country"] as Tab[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className="rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition-all"
                      style={
                        tab === t
                          ? { background: "rgba(6,182,212,0.25)", color: "#67e8f9", boxShadow: "0 0 12px rgba(6,182,212,0.2)" }
                          : { color: "#64748b" }
                      }
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {selectedProfile && !isOwnView ? (
                    <span className="text-xs text-slate-500">Viewing {selectedProfile.display_name}</span>
                  ) : null}
                  {isOwnView ? (
                    <button className={BTN_PRIMARY} onClick={saveCoverage}>
                      Save coverage
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Country selector */}
              {tab === "country" ? (
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500/60"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.name}</option>
                  ))}
                </select>
              ) : null}

              {/* Place search */}
              {isOwnView ? (
                <div className="relative" ref={suggestionsRef}>
                  <input
                    className={INPUT}
                    placeholder={
                      tab === "world"
                        ? "Search a country — or click anywhere on the map"
                        : "Search a city or region — or click anywhere on the map"
                    }
                    value={placeQuery}
                    onChange={(e) => handlePlaceInput(e.target.value)}
                  />
                  {loadingPlaces ? (
                    <span className="absolute right-3 top-3 text-xs text-slate-600">searching…</span>
                  ) : null}
                  {suggestions.length > 0 ? (
                    <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-white/10 bg-[#0e1017] shadow-2xl shadow-black/70 backdrop-blur-xl">
                      {suggestions.map((r) => {
                        const parts = r.display_name.split(", ");
                        return (
                          <button
                            key={r.place_id}
                            className="w-full border-b border-white/5 px-4 py-3 text-left transition-colors hover:bg-white/5 last:border-0"
                            onClick={() => addPlace(r)}
                          >
                            <span className="text-sm font-medium text-white">{parts[0]}</span>
                            <span className="ml-1.5 text-xs text-slate-500">{parts.slice(1, 3).join(", ")}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Chips */}
              {isOwnView ? (
                <div className="flex min-h-6 flex-wrap gap-1.5">
                  {activePlaces.length === 0 ? (
                    <p className="text-xs text-slate-700">Nothing added yet — search above or click the map</p>
                  ) : (
                    activePlaces.map((p) => (
                      <Pill key={`${p.place_name}-${p.lat}`} onRemove={() => {
                        if (tab === "world") setWorldPlaces((prev) => prev.filter((x) => x.place_name !== p.place_name));
                        else setCountryPlaces((prev) => prev.filter((x) => x.place_name !== p.place_name));
                      }}>
                        {p.place_name}
                      </Pill>
                    ))
                  )}
                </div>
              ) : null}
            </div>

            {/* Map */}
            <div className="relative overflow-hidden rounded-2xl border border-white/8" style={{ height: 480 }}>
              <Map
                ref={mapRef}
                initialViewState={{ latitude: 20, longitude: 10, zoom: 1.3 }}
                mapStyle={MAP_STYLE}
                attributionControl={false}
                onClick={(e) => void handleMapClick(e.lngLat.lat, e.lngLat.lng)}
                style={{ cursor: isOwnView && !mapLocked ? "crosshair" : "grab" }}
              >
                {!mapLocked
                  ? activePlaces.map((p) => (
                      <Marker key={`${p.place_name}-${p.lat}-${p.lng}`} latitude={p.lat} longitude={p.lng}>
                        <div
                          className="h-2.5 w-2.5 rounded-full border border-white/50 bg-cyan-400"
                          style={{ boxShadow: "0 0 10px 3px rgba(34,211,238,0.6)" }}
                        />
                      </Marker>
                    ))
                  : null}
              </Map>

              {/* Reset view */}
              <button
                onClick={resetMapView}
                title="Reset view"
                className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-xl border border-white/12 bg-black/60 px-2.5 py-1.5 text-[11px] text-slate-400 backdrop-blur transition-colors hover:text-white"
              >
                <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="8" cy="8" r="5.5" />
                  <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
                  <line x1="8" y1="1" x2="8" y2="4.5" />
                  <line x1="8" y1="11.5" x2="8" y2="15" />
                  <line x1="1" y1="8" x2="4.5" y2="8" />
                  <line x1="11.5" y1="8" x2="15" y2="8" />
                </svg>
                Reset view
              </button>

              {geocoding ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                  <div className="rounded-xl border border-white/12 bg-black/70 px-4 py-2.5 text-sm text-slate-300">
                    Identifying location…
                  </div>
                </div>
              ) : null}

              {mapLocked ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/75 p-6 text-center backdrop-blur-sm">
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-2xl text-2xl"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    🔒
                  </div>
                  <div>
                    <p className="font-semibold text-white">{selectedProfile?.display_name}'s map is private</p>
                    <p className="mt-1 max-w-xs text-sm text-slate-400">
                      Share your map with them — once they accept, they may share back and you'll see their pins here.
                    </p>
                  </div>
                  <button
                    className={BTN_PRIMARY}
                    onClick={() => selectedProfile && void shareMyMap(selectedProfile.id)}
                  >
                    Share my map with {selectedProfile?.display_name}
                  </button>
                </div>
              ) : null}
            </div>

            {info ? (
              <div className="rounded-xl border border-white/7 bg-white/[0.03] px-4 py-2.5 text-xs text-cyan-300">
                {info}
              </div>
            ) : null}
          </section>
        </main>
      )}
    </div>
  );
}

// ── Request card component ────────────────────────────────────────

function RequestCard({
  displayName,
  handle,
  onAccept,
  onReject,
  isDemo = false,
}: {
  displayName: string;
  handle: string;
  onAccept: () => void;
  onReject: () => void;
  isDemo?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/7 bg-white/[0.03] p-3">
      {isDemo ? (
        <span className="self-start rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
          Preview
        </span>
      ) : null}
      <div className="flex items-start gap-2.5">
        <Avatar name={displayName} className="h-8 w-8 text-xs" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">{displayName}</p>
          <p className="text-xs text-slate-500">@{handle} · wants to share their maps</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onAccept}
          className="flex-1 rounded-lg py-1.5 text-xs font-medium text-white transition-colors"
          style={{ background: "linear-gradient(135deg,rgba(16,185,129,0.7),rgba(5,150,105,0.7))", border: "1px solid rgba(16,185,129,0.3)" }}
        >
          ✓ Accept
        </button>
        <button
          onClick={onReject}
          className="flex-1 rounded-lg border border-white/8 bg-white/[0.04] py-1.5 text-xs text-slate-400 transition-colors hover:bg-white/[0.08]"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
