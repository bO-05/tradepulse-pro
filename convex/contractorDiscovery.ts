import { action } from "./_generated/server";
import { v } from "convex/values";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { components, internal } from "./_generated/api";
import { parseCityAndState } from "./agreements";

const firecrawl = new FirecrawlClient(components.firecrawl);

export interface DiscoveredContractor {
  companyName: string;
  contactEmail: string;
  phone?: string;
  /** Only present when the source actually published a license number. */
  licenseNumber?: string;
  /** Human-readable provenance label; never a bare "Verified" without a registry source. */
  licenseStatus?: string;
  sourceUrl: string;
}

export interface DiscoveryResult {
  success: boolean;
  tradePackageId: string;
  discoveredCount: number;
  insertedCount: number;
  source: string;
}

// F8: search titles are often mid-sentence SEO fragments once the brand suffix is
// stripped ("Commercial Electricians, Industrial, and High"). A fragment must never
// be stored as a company name.
const DANGLING_END_RX = /\b(?:and|or|for|in|on|at|to|with|by|from|of|the|a|an|&)\s*[,;]?\s*$/i;

/** Strict legal-entity markers. Trade nouns like "Plumbing" do not qualify. */
function hasLegalSuffix(title: string): boolean {
  return /\b(?:inc|llc|l\.l\.c|corp|corporation|co|company|companies|ltd|limited|group|associates|partners)\b/i.test(
    title
  );
}

function looksLikeSeoListFragment(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) return true;
  // Markdown-link leftovers / truncated fragments ("[Florida Fire Protection Contractor I").
  if (/^[^A-Za-z0-9]/.test(trimmed)) return true;
  if ((trimmed.match(/\[/g) || []).length !== (trimmed.match(/\]/g) || []).length) return true;
  // Page navigation / boilerplate headings are never company names.
  if (/^(?:business categories|menu|resources|sitemap|privacy policy|terms(?: of (?:use|service))?|services|about(?: us)?|contact(?: us)?|home|products|projects|blog|news)\b/i.test(trimmed)) {
    return true;
  }
  if (DANGLING_END_RX.test(trimmed)) return true;
  // Phone-book / ad copy, not a company name.
  if (/^(?:get|find|hire|call|need|looking for)\b/i.test(trimmed)) return true;
  if (/\b(?:hotline|near me|24\/7|on instagram|on facebook|on linkedin|profile page)\b/i.test(trimmed)) return true;
  // "... in Tampa" / "... in Tampa, FL" service copy. A legal entity never ends in a city.
  if (/\bin\s+[A-Z][a-zA-Z]+(?:,\s*[A-Z]{2})?$/.test(trimmed) && !hasLegalSuffix(trimmed)) return true;
  // Generic service descriptors ("Commercial AC Repair Tampa", "Quality Plumbing and
  // Commercial HVAC...") without a legal suffix are not company names.
  if (
    /^(?:commercial|residential|industrial|quality|affordable|reliable|trusted|local|expert|professional|licensed|insured)\b/i.test(trimmed) &&
    !hasLegalSuffix(trimmed)
  ) {
    return true;
  }
  if (
    /\b(?:licensing|requirements|repair|installation|cleaning|inspection|testing|maintenance)\b/i.test(trimmed) &&
    !hasLegalSuffix(trimmed)
  ) {
    return true;
  }
  // Comma/semicolon lists with no legal suffix and several words are SEO copy,
  // not a legal entity name.
  if (/[,;]/.test(trimmed) && !hasLegalSuffix(trimmed) && trimmed.split(/\s+/).length >= 5) return true;
  return false;
}

export function sanitizeContractorCompanyName(rawTitle: string, fallbackName: string): string {
  if (!rawTitle) return fallbackName;
  const title = rawTitle.replace(/[-|:–—].*$/, "").trim();
  const spammyPrefixes = [
    /^how to\b/i,
    /^(?:the\s+)?(?:top|best|\d+\s+best|\d+\s+top)\b/i,
    /^find\b/i,
    /^compare\b/i,
    /^why hire\b/i,
    /^commercial contractors? in\b/i,
    /^list of\b/i,
    /^directory of\b/i,
  ];
  if (
    spammyPrefixes.some((rx) => rx.test(title)) ||
    title.length > 50 ||
    title.length < 3 ||
    looksLikeSeoListFragment(title)
  ) {
    return fallbackName;
  }
  return title;
}

const PUBLISHED_EMAIL_RX = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/;
const PUBLISHED_PHONE_RX = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/;
// Require a real licence shape: known Texas/California prefix plus digits, or a
// generic LIC/M number. This prevents words like "ELECTRICIANS" matching "ELEC".
const PUBLISHED_LICENSE_RX =
  /\b(?:TX[-\s]?)?((?:TECL|TACLA|TACLB|TSBPE|RMP|PLMB|FIRE|CONC|STEEL|ROOF|FIN|ELEC)[-\s]?\d{3,7}[A-Z]?|(?:LIC|M)[-\s]?\d{4,7})\b/i;
const REGISTRY_HOSTS = [
  "tdlr.texas.gov",
  "pels.texas.gov",
  "tsbpe.texas.gov",
  "cslb.ca.gov",
  "dos.ny.gov",
  "myfloridalicense.com",
  "lni.wa.gov",
  "nclbgc.org",
  "roc.az.gov",
];
// Directory / aggregator hosts. Their pages are not contractor websites, so any
// contact or licence data on them cannot be attributed to the contractor safely.
const DIRECTORY_HOSTS = [
  "yelp.com",
  "yellowpages.com",
  "thumbtack.com",
  "buildzoom.com",
  "bbb.org",
  "angi.com",
  "angieslist.com",
  "houzz.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "pinterest.com",
  "nextdoor.com",
  "linkedin.com",
  "indeed.com",
  "ziprecruiter.com",
  "glassdoor.com",
  "mapquest.com",
  "chamberofcommerce.com",
  "manta.com",
  "dandb.com",
  "birdeye.com",
  "expertise.com",
  "porch.com",
  "homeadvisor.com",
  "threebestrated.com",
  "cylex.us.com",
  "hotfrog.com",
  "bizapedia.com",
  "downtobid.com",
  "constructionplacements.com",
  "buildersshowcase.com",
];

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isHostIn(url: string | undefined, hosts: string[]): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return hosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/** Heuristic: is this title plausibly a company name rather than SEO copy? */
export function looksLikeCompanyName(title: string): boolean {
  if (!title) return false;
  if (looksLikeSeoListFragment(title)) return false;
  const generic = /^(?:electricians?|plumbers?|contractors?|hvac|mechanical|electrical|commercial)$/i;
  if (generic.test(title.trim())) return false;
  if (/^(?:about|home|contact|welcome|services|products|projects|blog|news)\b/i.test(title.trim())) return false;
  const companyToken = /\b(inc|llc|l\.l\.c|corp|corporation|co|company|ltd|limited|group|systems?|services?|electric(?:al)?|plumbing|mechanical|hvac|contractors?|construction|engineering|technologies|solutions|industries)\b/i;
  const wordCount = title.trim().split(/\s+/).length;
  return companyToken.test(title) || wordCount >= 2;
}

function findPublishedEmail(text: string | undefined): string | null {
  if (!text) return null;
  const match = text.match(PUBLISHED_EMAIL_RX);
  return match ? match[0].toLowerCase() : null;
}

function findPublishedPhone(text: string | undefined): string | null {
  if (!text) return null;
  const match = text.match(PUBLISHED_PHONE_RX);
  return match ? `+1 (${match[1]}) ${match[2]}-${match[3]}` : null;
}

function findPublishedLicense(text: string | undefined): string | null {
  if (!text) return null;
  const match = text.match(PUBLISHED_LICENSE_RX);
  return match ? match[1].replace(/\s+/g, "-").toUpperCase() : null;
}

function isRegistrySource(url: string | undefined): boolean {
  return isHostIn(url, REGISTRY_HOSTS);
}

/**
 * Maps one search hit to a contractor record using only published data.
 * License numbers, phone numbers and emails are recorded only when the scraped
 * page actually contains them; otherwise the record is explicitly unverified.
 * Returns null for directory pages and junk titles so no record is invented.
 */
function mapSearchItemToContractor(item: any, registryUrl: string): DiscoveredContractor | null {
  if (isHostIn(item?.url, DIRECTORY_HOSTS) || isHostIn(item?.url, REGISTRY_HOSTS)) {
    return null;
  }
  const cleanTitle = sanitizeContractorCompanyName(item?.title, "");
  if (!cleanTitle || !looksLikeCompanyName(cleanTitle)) {
    return null;
  }
  // Search titles often carry the brand after a separator
  // ("Commercial Electrical Contractor in Austin, TX - FSG").
  const rawTitle = String(item?.title || "");
  const brandMatch = rawTitle.match(/[-–—|:]\s*([A-Z][A-Za-z0-9&.']{1,24})\s*$/);
  const brandCandidate = brandMatch ? brandMatch[1].trim() : "";
  const brandAcronym = /^[A-Z][A-Za-z]{1,5}$/.test(brandCandidate) && /[A-Z]{2,}/.test(brandCandidate) ? brandCandidate : "";
  const markdown: string = typeof item?.markdown === "string" ? item.markdown : "";
  const description: string = typeof item?.description === "string" ? item.description : "";
  const combinedText = `${markdown}\n${description}`;
  // Prefer the page's own H1/H2 over the search-result title when it looks like a
  // company name; search titles are often SEO copy ("... in Austin, TX - FSG").
  const headingMatch = markdown.match(/^#{1,2}\s+(.+)$/m);
  const headingCandidate = headingMatch ? sanitizeContractorCompanyName(headingMatch[1], "") : "";
  const finalName = brandAcronym || (looksLikeCompanyName(headingCandidate) ? headingCandidate : cleanTitle);
  if (!brandAcronym && (!finalName || !looksLikeCompanyName(finalName))) {
    return null;
  }
  const sourceUrl: string = item?.url || registryUrl;
  const publishedEmail = findPublishedEmail(combinedText);
  const publishedPhone = findPublishedPhone(combinedText);
  const publishedLicense = findPublishedLicense(combinedText);
  const registryMatch = isRegistrySource(item?.url);
  return {
    companyName: finalName,
    contactEmail: publishedEmail || "not-published@verify-required.invalid",
    phone: publishedPhone || undefined,
    licenseNumber: publishedLicense || "Not verified",
    licenseStatus:
      publishedLicense && registryMatch
        ? "Verified in listing (registry page)"
        : "Unverified — from web search result",
    sourceUrl,
  };
}

export const discoverSubcontractors = action({
  args: {
    tradePackageId: v.id("tradePackages"),
  },
  handler: async (ctx, args): Promise<DiscoveryResult> => {
    const tradePkg = await ctx.runQuery(internal.tradePackages.getPackageInternal, {
      tradePackageId: args.tradePackageId,
    });
    if (!tradePkg) throw new Error("Trade package not found");

    const project: any = await ctx.runQuery(internal.projects.getProjectInternal, {
      projectId: tradePkg.projectId,
    });
    const projectLocation = project?.location || "Austin, TX";
    const { stateAbbr: state } = parseCityAndState(projectLocation);

    const STATE_CONFIG: Record<string, { board: string; prefix: string; areaCode: string; registryUrl: string }> = {
      TX: { board: "TDLR / Texas Board of Professional Engineers", prefix: "TX", areaCode: "512", registryUrl: "https://pels.texas.gov/" },
      CA: { board: "CSLB (California State License Board)", prefix: "CA", areaCode: "415", registryUrl: "https://www.cslb.ca.gov/" },
      NY: { board: "NYSDOS / NYC DOB", prefix: "NY", areaCode: "212", registryUrl: "https://dos.ny.gov/licensing-services" },
      FL: { board: "DBPR (Florida Construction Licensing)", prefix: "FL", areaCode: "305", registryUrl: "https://www.myfloridalicense.com/" },
      IL: { board: "IL DPOR / City of Chicago Dept of Buildings", prefix: "IL", areaCode: "312", registryUrl: "https://idfpr.illinois.gov/" },
      CO: { board: "DORA (Colorado Division of Professions and Occupations)", prefix: "CO", areaCode: "303", registryUrl: "https://dpo.colorado.gov/" },
      WA: { board: "WA Dept of Labor & Industries", prefix: "WA", areaCode: "206", registryUrl: "https://secure.lni.wa.gov/verify/" },
      GA: { board: "Georgia Professional Licensing Board", prefix: "GA", areaCode: "404", registryUrl: "https://sos.ga.gov/georgia-state-licensing-board-residential-and-general-contractors" },
      NC: { board: "NC State Licensing Board for Contractors", prefix: "NC", areaCode: "919", registryUrl: "https://www.nclbgc.org/" },
      OH: { board: "Ohio Construction Industry Licensing Board", prefix: "OH", areaCode: "614", registryUrl: "https://com.ohio.gov/divisions-and-programs/industrial-compliance/boards/ohio-construction-industry-licensing-board" },
      PA: { board: "Pennsylvania Dept of Labor & Industry", prefix: "PA", areaCode: "215", registryUrl: "https://www.pa.gov/" },
      MA: { board: "MA Office of Consumer Affairs and Business Reg", prefix: "MA", areaCode: "617", registryUrl: "https://www.mass.gov/orgs/office-of-consumer-affairs-and-business-regulation" },
      VA: { board: "VA DPOR Board for Contractors", prefix: "VA", areaCode: "804", registryUrl: "https://www.dpor.virginia.gov/Boards/Contractors" },
      AZ: { board: "Arizona Registrar of Contractors (ROC)", prefix: "AZ", areaCode: "602", registryUrl: "https://roc.az.gov/" },
      MI: { board: "MI LARA Licensing and Regulatory Affairs", prefix: "MI", areaCode: "313", registryUrl: "https://www.michigan.gov/lara" },
      NJ: { board: "NJ Dept of Community Affairs (DCA)", prefix: "NJ", areaCode: "201", registryUrl: "https://www.nj.gov/dca/" },
      TN: { board: "TN Board for Licensing Contractors", prefix: "TN", areaCode: "615", registryUrl: "https://www.tn.gov/commerce/regboards/contractors.html" },
      MN: { board: "MN Dept of Labor and Industry (DLI)", prefix: "MN", areaCode: "612", registryUrl: "https://www.dli.mn.gov/" },
      MD: { board: "MD Dept of Labor Licensing & Regulation", prefix: "MD", areaCode: "410", registryUrl: "https://www.dllr.state.md.us/" },
      MO: { board: "MO Division of Professional Registration", prefix: "MO", areaCode: "314", registryUrl: "https://pr.mo.gov/" },
      IN: { board: "Indiana Professional Licensing Agency", prefix: "IN", areaCode: "317", registryUrl: "https://www.in.gov/pla/" },
    };

    const stateCfg = STATE_CONFIG[state] || {
      board: `${state} State Licensing Board`,
      prefix: state,
      areaCode: "512",
      registryUrl: "https://www.nascla.org/",
    };

    const firecrawlKey = process.env.FIRECRAWL_API_KEY;
    const discoveredContractors: DiscoveredContractor[] = [];

    if (firecrawlKey) {
      try {
        const queryStr = `commercial ${tradePkg.tradeName} contractors ${projectLocation} license`;
        // Primary: @firecrawl/firecrawl-convex component search
        try {
          const searchResp = await firecrawl.search(ctx as any, queryStr, {
            limit: 5,
            location: "US",
            scrapeOptions: { formats: ["markdown"] },
          });
          const anyResp = searchResp as any;
          const items = Array.isArray(anyResp.data)
            ? anyResp.data
            : Array.isArray(anyResp.web)
            ? anyResp.web
            : Array.isArray(anyResp.data?.web)
            ? anyResp.data.web
            : [];
          for (let i = 0; i < items.length; i++) {
            const item: any = items[i];
            const mapped = mapSearchItemToContractor(item, stateCfg.registryUrl);
            if (mapped) discoveredContractors.push(mapped);
          }
        } catch {
          // Direct API fallback with country: "US"
          const resp = await fetch("https://api.firecrawl.dev/v2/search", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${firecrawlKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: queryStr,
              limit: 5,
              country: "US",
              scrapeOptions: { formats: ["markdown"] },
            }),
          });

          if (resp.ok) {
            const result: any = await resp.json();
            const items = Array.isArray(result.data)
              ? result.data
              : Array.isArray(result.data?.web)
              ? result.data.web
              : Array.isArray(result.web)
              ? result.web
              : [];
            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              const mapped = mapSearchItemToContractor(item, stateCfg.registryUrl);
              if (mapped) discoveredContractors.push(mapped);
            }
          }
        }
      } catch (err) {
        console.warn("Firecrawl search failed or returned nothing usable; no records will be created:", err);
      }
    }

    // No live results: return an honest empty result. The product never invents
    // contractors, licence numbers or contacts; the UI shows a retry/empty state.
    if (discoveredContractors.length === 0) {
      await ctx.runMutation(internal.auditLogs.recordLogInternal, {
        projectId: tradePkg.projectId,
        tradePackageId: args.tradePackageId,
        eventType: "compliance_audit",
        title: `Discovery returned no usable contractors: Division ${tradePkg.csiDivision}`,
        description: "Firecrawl returned no contractor pages with published contact data. No records were created; retry or add a contractor manually.",
        actor: "TradePulse Discovery Engine",
      });
      return {
        success: true,
        tradePackageId: args.tradePackageId,
        discoveredCount: 0,
        insertedCount: 0,
        source: "Firecrawl web search (no usable results)",
      };
    }

    const insertedIds: any = await ctx.runMutation(
      internal.contractors.batchInsertContractors,
      {
        tradePackageId: args.tradePackageId,
        contractors: discoveredContractors.map((contractor) => ({
          ...contractor,
          licenseNumber: contractor.licenseNumber || "Not verified",
          licenseStatus: contractor.licenseStatus || "Unverified",
        })),
      }
    );

    const source = "Firecrawl web search (license data only when published in the source)";

    // Record in reactive audit stream
    await ctx.runMutation(internal.auditLogs.recordLogInternal, {
      projectId: tradePkg.projectId,
      tradePackageId: args.tradePackageId,
      eventType: "compliance_audit",
      title: `Contractors Discovered: Division ${tradePkg.csiDivision}`,
      description: `Discovered ${discoveredContractors.length} contractor record(s) via Firecrawl web search. License numbers and contacts are recorded only when published in the source; verify before sourcing.`,
      actor: "TradePulse Discovery Engine",
    });

    return {
      success: true,
      tradePackageId: args.tradePackageId,
      discoveredCount: discoveredContractors.length,
      insertedCount: insertedIds.length,
      source,
    };
  },
});

/**
 * Scrapes a contractor's website or licensing profile using FirecrawlClient
 * extracting clean markdown specification details, licensing status, and capabilities.
 */
export const scrapeContractorWebsite = action({
  args: {
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const firecrawlKey = process.env.FIRECRAWL_API_KEY;
    if (firecrawlKey) {
      try {
        const doc = await firecrawl.scrape(ctx as any, args.url, {
          formats: ["markdown"],
        });
        return {
          success: true,
          url: args.url,
          markdown: doc.markdown ?? "",
          title: doc.metadata?.title ?? "Contractor Commercial Profile",
          source: "FirecrawlClient Website Scraping",
        };
      } catch (err) {
        console.warn("FirecrawlClient scrape failed, falling back:", err);
      }
    }

    return {
      success: true,
      url: args.url,
      markdown: "",
      title: "Contractor profile",
      source: "Live scrape unavailable",
      error:
        "Live website scraping is unavailable because FIRECRAWL_API_KEY is not configured. No licensing or compliance data was retrieved.",
    };
  },
});
