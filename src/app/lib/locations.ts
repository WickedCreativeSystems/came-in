// The shops this browser holds (plan 3.13), for the header's switcher and Setup's Locations.
import { api } from "./api";

export interface Locations {
  current: string;
  shops: { id: string; name: string; avatarUrl: string | null }[];
  /** This shop's locations (plan 3.13). */
  locations: { id: string; name: string; first: boolean; hasTaps: boolean }[];
  cap: number;
  price: string | null;
  pay: boolean;
}

export function fetchLocations(): Promise<Locations> {
  return api<Locations>("/api/locations");
}

export async function switchTo(id: string): Promise<void> {
  await api("/setup/switch", { json: { shop: id } });
  location.href = "/wall";
}
