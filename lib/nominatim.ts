export type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address: {
    country_code?: string;
    country?: string;
    state?: string;
  };
};

export type NominatimReverseResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address: {
    city?: string;
    town?: string;
    village?: string;
    suburb?: string;
    county?: string;
    state_district?: string;
    state?: string;
    country?: string;
    country_code?: string;
  };
};

export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<NominatimReverseResult | null> {
  try {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lon: lng.toString(),
      format: "json",
      addressdetails: "1",
      "accept-language": "en",
    });
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?${params}`,
      { headers: { "User-Agent": "KnowYourEarthCoverage/1.0" } },
    );
    if (!res.ok) return null;
    return (await res.json()) as NominatimReverseResult;
  } catch {
    return null;
  }
}

export async function searchPlaces(
  query: string,
  countryCode?: string,
): Promise<NominatimResult[]> {
  if (query.trim().length < 2) return [];
  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "6",
    addressdetails: "1",
    "accept-language": "en",
  });
  if (countryCode) params.set("countrycodes", countryCode.toLowerCase());
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?${params}`,
      { headers: { "User-Agent": "KnowYourEarthCoverage/1.0" } },
    );
    if (!res.ok) return [];
    return (await res.json()) as NominatimResult[];
  } catch {
    return [];
  }
}
