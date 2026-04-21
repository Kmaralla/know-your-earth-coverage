"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { Marker, type MapRef } from "react-map-gl/maplibre";
import type { User } from "@supabase/supabase-js";
import { COUNTRIES, COUNTRY_STATE_COUNTS } from "@/lib/geo";
import { reverseGeocode, searchPlaces, type NominatimResult } from "@/lib/nominatim";
import { createClient } from "@/lib/supabase/client";
import type { Profile, PlaceEntry } from "@/lib/types";

type Tab = "world" | "country";
type IncomingRequest = { id: number; sender_id: string; sender: Profile[] | Profile | null };

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";
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

const CARD = "rounded-2xl border border-white/[0.11] bg-white/[0.07] backdrop-blur-xl";
const INPUT =
  "w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/60";
const BTN_GHOST =
  "rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-slate-300 transition-all duration-150 hover:bg-white/[0.09] hover:text-white active:scale-[0.95] active:bg-white/[0.13] select-none";
const BTN_PRIMARY =
  "rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition-all duration-150 hover:brightness-110 active:scale-[0.95] active:brightness-90 select-none";

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
  const [shareHandle, setShareHandle] = useState<string | null>(null);
  const [guestMode, setGuestMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [listModal, setListModal] = useState<{ title: string; items: string[] } | null>(null);
  const hasDefaultedCountry = useRef(false);
  const [friends, setFriends] = useState<Profile[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  const isLoggedIn = Boolean(user);
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

  const loadFriends = useCallback(
    async (userId: string) => {
      const [{ data: sent }, { data: received }] = await Promise.all([
        supabase
          .from("connections")
          .select("receiver:profiles!connections_receiver_id_fkey(id,handle,display_name,description)")
          .eq("sender_id", userId)
          .eq("status", "accepted"),
        supabase
          .from("connections")
          .select("sender:profiles!connections_sender_id_fkey(id,handle,display_name,description)")
          .eq("receiver_id", userId)
          .eq("status", "accepted"),
      ]);
      const seen = new Set<string>();
      const result: Profile[] = [];
      for (const row of (sent ?? []) as Array<{ receiver: Profile | Profile[] | null }>) {
        const p = Array.isArray(row.receiver) ? row.receiver[0] : row.receiver;
        if (p && !seen.has(p.id)) { seen.add(p.id); result.push(p); }
      }
      for (const row of (received ?? []) as Array<{ sender: Profile | Profile[] | null }>) {
        const p = Array.isArray(row.sender) ? row.sender[0] : row.sender;
        if (p && !seen.has(p.id)) { seen.add(p.id); result.push(p); }
      }
      setFriends(result);
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
      await loadFriends(loggedUser.id);
    };
    // Read URL params
    const params = new URLSearchParams(window.location.search);
    const h = params.get("share");
    if (h) setShareHandle(h);

    // Show a friendly message if Supabase redirected here with an auth error
    const authError = params.get("error_code") ?? params.get("error");
    if (authError) {
      const desc = params.get("error_description")?.replace(/\+/g, " ") ?? authError;
      if (authError === "otp_expired") {
        setInfo("Magic link expired — please request a new one below.");
      } else {
        setInfo(`Sign-in error: ${desc}`);
      }
      // Clean the error params from the URL so they don't persist on reload
      window.history.replaceState({}, "", window.location.pathname);
    }

    void boot();
  }, [loadCoverage, loadFriends, loadIncoming, supabase]);

  // Auto-load a shared profile once the user is authenticated
  useEffect(() => {
    if (!user || !shareHandle) return;
    const autoLoad = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id,handle,display_name,description")
        .eq("handle", shareHandle)
        .single();
      if (data && data.id !== user.id) {
        const p = data as Profile;
        setSelectedProfile(p);
        const { data: conn } = await supabase
          .from("connections")
          .select("id")
          .eq("sender_id", p.id)
          .eq("receiver_id", user.id)
          .eq("status", "accepted")
          .limit(1);
        const allowed = Boolean(conn && conn.length > 0);
        setCanViewSelected(allowed);
        if (allowed) await loadCoverage(p.id);
      }
      setShareHandle(null);
      window.history.replaceState({}, "", window.location.pathname);
    };
    void autoLoad();
  }, [user, shareHandle, supabase, loadCoverage]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (tab === "country") {
      const c = COUNTRIES.find((c) => c.code === countryCode);
      if (c) mapRef.current.flyTo({ center: [c.lng, c.lat], zoom: 4, duration: 1200 });
    } else {
      mapRef.current.flyTo({ ...WORLD_VIEW, duration: 1200 });
    }
  }, [tab, countryCode]);

  // Default country tab to first country that has world pins
  useEffect(() => {
    if (hasDefaultedCountry.current || worldPlaces.length === 0) return;
    hasDefaultedCountry.current = true;
    setCountryCode(worldPlaces[0].country_code);
  }, [worldPlaces]);

  // Realtime presence — track who's online
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel("presence:global", {
      config: { presence: { key: user.id } },
    });
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setOnlineUserIds(new Set(Object.keys(state)));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ user_id: user.id, online_at: Date.now() });
        }
      });
    return () => { void supabase.removeChannel(channel); };
  }, [user, supabase]);

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
    // Build callback URL, preserving ?share= if present
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    const shareParam = new URLSearchParams(window.location.search).get("share");
    if (shareParam) callbackUrl.searchParams.set("next", `/?share=${shareParam}`);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl.toString() },
    });
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

    // Accepting is mutual — also create the reverse connection so they can see your map too
    if (status === "accepted" && user) {
      const req = incoming.find((r) => r.id === requestId);
      if (req) {
        await supabase.from("connections").upsert(
          { sender_id: user.id, receiver_id: req.sender_id, status: "accepted" },
          { onConflict: "sender_id,receiver_id" },
        );
      }
    }

    if (user) {
      await loadIncoming(user.id);
      if (status === "accepted") await loadFriends(user.id);
    }
  }

  async function recheckSelectedProfile() {
    if (!selectedProfile || !user) return;
    const { data } = await supabase
      .from("connections")
      .select("id")
      .eq("sender_id", selectedProfile.id)
      .eq("receiver_id", user.id)
      .eq("status", "accepted")
      .limit(1);
    const allowed = Boolean(data && data.length > 0);
    setCanViewSelected(allowed);
    if (allowed) await loadCoverage(selectedProfile.id);
  }

  function copyShareLink() {
    if (!profile) return;
    void navigator.clipboard.writeText(`${window.location.origin}?share=${profile.handle}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setInfo("Profile link copied to clipboard ✓");
      setTimeout(() => setInfo(""), 3000);
    });
  }

  function shareOnX() {
    if (!profile) return;
    const url = `${window.location.origin}?share=${profile.handle}`;
    const text = `Check out my travel coverage on Know Your Earth Coverage! 🌍`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank");
  }

  function shareOnLinkedIn() {
    if (!profile) return;
    const url = `${window.location.origin}?share=${profile.handle}`;
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`, "_blank");
  }

  function shareOnFacebook() {
    if (!profile) return;
    const url = `${window.location.origin}?share=${profile.handle}`;
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, "_blank");
  }

  // ── Render ────────────────────────────────────────────────────────

  const totalPlaces = worldPlaces.length + allCountryRows.length;
  const worldPct = Math.round(worldPlaces.length / 195 * 100);
  const stateTotal = COUNTRY_STATE_COUNTS[countryCode];
  const cityPct = tab === "country" && stateTotal && countryPlaces.length > 0
    ? Math.round(countryPlaces.length / stateTotal * 100)
    : null;

  return (
    <div
      className="min-h-screen text-slate-100"
      style={{
        background:
          "radial-gradient(ellipse 70% 55% at -8% -10%, rgba(251,146,60,0.32) 0%, transparent 52%)," +
          "radial-gradient(ellipse 55% 45% at 108% -5%, rgba(14,165,233,0.22) 0%, transparent 50%)," +
          "radial-gradient(ellipse 80% 50% at 50% 108%, rgba(124,58,237,0.16) 0%, transparent 48%)," +
          "radial-gradient(ellipse 40% 35% at 88% 58%, rgba(251,191,36,0.09) 0%, transparent 50%)," +
          "radial-gradient(ellipse 35% 30% at 15% 70%, rgba(20,184,166,0.10) 0%, transparent 50%)," +
          "#03070f",
      }}
    >
      {/* Top accent stripe */}
      <div
        className="pointer-events-none fixed left-0 right-0 top-0 z-50 h-[2px]"
        style={{ background: "linear-gradient(90deg, transparent 0%, #06b6d4 20%, #a78bfa 50%, #fb923c 80%, transparent 100%)" }}
      />
      {/* Coordinate grid */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.03) 1px,transparent 1px)," +
            "linear-gradient(90deg,rgba(255,255,255,0.03) 1px,transparent 1px)",
          backgroundSize: "80px 80px",
        }}
      />

      {/* ── Header ── */}
      <header className="relative mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl text-lg"
            style={{ background: "linear-gradient(135deg,rgba(6,182,212,0.35),rgba(99,102,241,0.35))", border: "1px solid rgba(6,182,212,0.45)", boxShadow: "0 0 20px rgba(6,182,212,0.25)" }}
          >
            🌍
          </div>
          <div>
            <h1
              className="text-xl font-black tracking-tight"
              style={{
                background: "linear-gradient(110deg,#fff 10%,#22d3ee 45%,#a78bfa 70%,#fb923c 95%)",
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
              {copied ? "✓ Copied!" : "Share profile"}
            </button>
            <button
              onClick={shareOnX}
              title="Share on X"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-xs text-slate-400 transition-colors hover:bg-white/[0.09] hover:text-white"
            >
              𝕏
            </button>
            <button
              onClick={shareOnLinkedIn}
              title="Share on LinkedIn"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-xs font-bold text-slate-400 transition-colors hover:bg-white/[0.09] hover:text-white"
            >
              in
            </button>
            <button
              onClick={shareOnFacebook}
              title="Share on Facebook"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-xs font-bold text-slate-400 transition-colors hover:bg-white/[0.09] hover:text-white"
            >
              f
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
      {!user && !guestMode ? (
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
          {info ? (
            <p className={`text-xs ${info.includes("expired") || info.includes("error") ? "rounded-xl border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-amber-300" : "text-slate-500"}`}>
              {info}
            </p>
          ) : null}
          {shareHandle ? (
            <p className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-300">
              Sign in to view <span className="font-semibold">@{shareHandle}</span>'s travel map.
            </p>
          ) : (
            <p className="text-[11px] text-slate-700">No password. No tracking. Just your pins.</p>
          )}
          <div className="flex w-full items-center gap-3">
            <div className="h-px flex-1 bg-white/8" />
            <span className="text-[11px] text-slate-700">or</span>
            <div className="h-px flex-1 bg-white/8" />
          </div>
          <button
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-sm text-slate-500 transition-colors hover:bg-white/[0.07] hover:text-slate-300"
            onClick={() => setGuestMode(true)}
          >
            Continue as guest — explore without signing in
          </button>
        </main>
      ) : (
        /* ── Main app (logged-in OR guest) ── */
        <main className="relative mx-auto w-full max-w-7xl px-6 pb-10">
          {/* Guest banner */}
          {guestMode ? (
            <div className="mb-4 flex items-center justify-between gap-4 rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
              <p className="text-xs text-amber-300">
                <span className="font-semibold">Guest mode</span> — your pins are visible but not saved. Sign in to keep your coverage.
              </p>
              <button
                className="flex-shrink-0 rounded-xl bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/30"
                onClick={() => setGuestMode(false)}
              >
                Sign in
              </button>
            </div>
          ) : null}
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">

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
                  <div className="rounded-xl border border-white/7 bg-white/[0.03] p-3 flex flex-col gap-2">
                    <p className="text-xs text-slate-500">Their map is private. Share yours — when they accept, both of you can see each other's coverage.</p>
                    <button className={`${BTN_PRIMARY} w-full py-2 text-xs`} onClick={() => void shareMyMap(selectedProfile.id)}>
                      Share my map with them
                    </button>
                    <button
                      className="w-full text-[11px] text-slate-600 underline underline-offset-2 transition-colors hover:text-slate-400"
                      onClick={() => void recheckSelectedProfile()}
                    >
                      Already sent a request? Check if they accepted →
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
                          {user?.id !== p.id ? (
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

            {/* Connected Friends */}
            {isOwnView && friends.length > 0 ? (
              <div className={`${CARD} flex flex-col gap-3 p-4`}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Friends</p>
                  {friends.some((f) => onlineUserIds.has(f.id)) ? (
                    <span className="flex items-center gap-1.5 text-[10px] text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      {friends.filter((f) => onlineUserIds.has(f.id)).length} online
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-600">all offline</span>
                  )}
                </div>
                {friends.map((f) => (
                  <button
                    key={f.id}
                    className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/5"
                    onClick={() => void selectProfile(f)}
                  >
                    <div className="relative flex-shrink-0">
                      <Avatar name={f.display_name} className="h-8 w-8 text-xs" />
                      <span
                        className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2"
                        style={{
                          background: onlineUserIds.has(f.id) ? "#34d399" : "#475569",
                          borderColor: "#080b14",
                        }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{f.display_name}</p>
                      <p className="text-[10px] text-slate-500">
                        {onlineUserIds.has(f.id) ? "● Online" : "○ Offline"} · @{f.handle}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </aside>

          {/* ── RIGHT PANEL ── */}
          <section className="flex flex-col gap-3">

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  value: worldPlaces.length,
                  label: "Countries",
                  pct: worldPct,
                  pctDetail: `${worldPlaces.length} / 195`,
                  accentColor: "#67e8f9",
                  items: worldPlaces.map(p => p.place_name),
                  gradient: "linear-gradient(135deg,#7dd3fc,#06b6d4)",
                  glow: "rgba(6,182,212,0.55)",
                  border: "rgba(6,182,212,0.22)",
                  bg: "rgba(6,182,212,0.07)",
                },
                {
                  value: tab === "country" ? countryPlaces.length : allCountryRows.length,
                  label: tab === "country" ? "States / cities" : "Cities & regions",
                  pct: cityPct,
                  pctDetail: stateTotal && tab === "country" ? `${countryPlaces.length} / ${stateTotal} states` : null,
                  accentColor: "#fcd34d",
                  items: allCountryRows.map(p => p.place_name),
                  gradient: "linear-gradient(135deg,#fcd34d,#f97316)",
                  glow: "rgba(249,115,22,0.55)",
                  border: "rgba(249,115,22,0.22)",
                  bg: "rgba(249,115,22,0.07)",
                },
                {
                  value: totalPlaces,
                  label: "Total pins",
                  pct: null,
                  pctDetail: null,
                  accentColor: "#d8b4fe",
                  items: [...worldPlaces, ...allCountryRows].map(p => p.place_name),
                  gradient: "linear-gradient(135deg,#d8b4fe,#a855f7)",
                  glow: "rgba(168,85,247,0.55)",
                  border: "rgba(168,85,247,0.22)",
                  bg: "rgba(168,85,247,0.07)",
                },
              ].map(({ value, label, pct, pctDetail, accentColor, items, gradient, glow, border, bg }) => (
                <div
                  key={label}
                  className="flex flex-col items-center gap-1 rounded-2xl py-5 text-center backdrop-blur-xl"
                  style={{
                    background: bg,
                    border: `1px solid ${border}`,
                    boxShadow: `0 0 30px ${glow.replace("0.55","0.12")}, inset 0 1px 0 ${border}`,
                  }}
                >
                  <p
                    className="text-5xl font-black tabular-nums leading-none"
                    style={{
                      background: gradient,
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                      filter: `drop-shadow(0 0 14px ${glow})`,
                    }}
                  >
                    {value}
                  </p>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</p>
                  {pct !== null ? (
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums"
                        style={{ background: `${accentColor}22`, color: accentColor }}
                      >
                        {pct}%
                      </span>
                      {pctDetail ? (
                        <span className="text-[9px] text-slate-600">{pctDetail}</span>
                      ) : null}
                    </div>
                  ) : null}
                  {value > 0 ? (
                    <button
                      onClick={() => setListModal({ title: label, items })}
                      className="mt-1 text-[9px] text-slate-600 underline underline-offset-2 transition-colors hover:text-slate-400"
                    >
                      view list
                    </button>
                  ) : null}
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
                  {isOwnView && isLoggedIn ? (
                    <button className={BTN_PRIMARY} onClick={saveCoverage}>
                      Save coverage
                    </button>
                  ) : isOwnView && guestMode ? (
                    <button
                      className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-300 transition-colors hover:bg-cyan-500/20"
                      onClick={() => setGuestMode(false)}
                    >
                      Sign in to save →
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Country selector */}
              {tab === "country" ? (
                <>
                  <select
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500/60"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                  {worldPlaces.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="self-center text-[10px] font-semibold uppercase tracking-widest text-slate-600">Quick jump:</span>
                      {worldPlaces.map((p) => (
                        <button
                          key={p.country_code}
                          onClick={() => setCountryCode(p.country_code)}
                          className="rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors"
                          style={
                            countryCode === p.country_code
                              ? { background: "rgba(6,182,212,0.2)", border: "1px solid rgba(6,182,212,0.4)", color: "#67e8f9" }
                              : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#64748b" }
                          }
                        >
                          {p.place_name.split(",")[0]}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
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
            <div
              className="relative overflow-hidden rounded-2xl"
              style={{
                height: 480,
                border: "1px solid rgba(6,182,212,0.25)",
                boxShadow: "0 0 50px rgba(6,182,212,0.10), 0 0 0 1px rgba(6,182,212,0.06)",
              }}
            >
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
                      <Marker key={`${p.place_name}-${p.lat}-${p.lng}`} latitude={p.lat} longitude={p.lng} anchor="bottom">
                        <div className="flex flex-col items-center" style={{ filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.35))" }}>
                          {/* Label above pin */}
                          <div
                            className="mb-1 max-w-[110px] truncate rounded-md px-2 py-0.5 text-center text-[10px] font-bold leading-tight text-slate-800"
                            style={{
                              background: "rgba(255,255,255,0.97)",
                              border: "1px solid rgba(0,0,0,0.08)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {p.place_name.split(",")[0]}
                          </div>
                          {/* Pin dot */}
                          <div
                            className="h-4 w-4 rounded-full border-2 border-white"
                            style={{
                              background: "linear-gradient(135deg, #f43f5e, #dc2626)",
                              boxShadow: "0 0 0 2px rgba(244,63,94,0.35)",
                            }}
                          />
                          {/* Pin stem */}
                          <div className="h-2 w-0.5" style={{ background: "#be123c" }} />
                        </div>
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
                      Share your map with them. When they accept, both of you can see each other's coverage.
                    </p>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <button
                      className={BTN_PRIMARY}
                      onClick={() => selectedProfile && void shareMyMap(selectedProfile.id)}
                    >
                      Share my map with {selectedProfile?.display_name}
                    </button>
                    <button
                      className="text-xs text-slate-500 underline underline-offset-2 transition-colors hover:text-slate-300"
                      onClick={() => void recheckSelectedProfile()}
                    >
                      Already sent a request? Check if they accepted →
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {info ? (
              <div className="rounded-xl border border-white/7 bg-white/[0.03] px-4 py-2.5 text-xs text-cyan-300">
                {info}
              </div>
            ) : null}
          </section>
          </div>{/* end inner grid */}
        </main>
      )}

      {/* List modal */}
      {listModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(4,6,14,0.80)", backdropFilter: "blur(8px)" }}
          onClick={() => setListModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-white/[0.11] bg-[#0b0f1c] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold text-white">{listModal.title}</p>
              <button
                onClick={() => setListModal(null)}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-slate-400 transition-colors hover:text-white"
              >
                ×
              </button>
            </div>
            {listModal.items.length === 0 ? (
              <p className="text-xs text-slate-600">Nothing added yet.</p>
            ) : (
              <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                {listModal.items.map((item, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-cyan-400" />
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
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
