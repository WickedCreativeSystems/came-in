// The shops this browser holds (plan 3.13), for the header's switcher and Setup's Locations.
import { api } from "./api";

export interface Locations {
  current: string;
  shops: { id: string; name: string; avatarUrl: string | null }[];
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
