import { Context } from "hono";
import { getAllCapabilities } from "../core/data/capabilityQueries";
import { CapabilityCatalogPage } from "../pages/CapabilityCatalogPage";
import { loadDataContext } from "../loaders/loadDataContext";

const { capabilities, teams } = await loadDataContext()

export function handleCapabilityCatalog(c: Context) {
  const allCapabilities = getAllCapabilities(capabilities);

  return c.html(<CapabilityCatalogPage teams={teams} allCapabilities={allCapabilities} />);
};
