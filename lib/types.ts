export type Profile = {
  id: string;
  handle: string;
  display_name: string;
  description: string | null;
};

export type PlaceEntry = {
  country_code: string;
  place_name: string;
  lat: number;
  lng: number;
};
