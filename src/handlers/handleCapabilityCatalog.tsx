import { Context } from "hono";
import { CapabilityCatalogPage } from "../pages/CapabilityCatalogPage";
import { loadDataContext } from "../loaders/loadDataContext";

const { capabilities, teams } = await loadDataContext()

export function handleCapabilityCatalog(c: Context) {
  return c.html(<CapabilityCatalogPage teams={teams} allCapabilities={capabilities} />);
};
