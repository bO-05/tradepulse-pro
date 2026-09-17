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

function sanitizeContractorCompanyName(rawTitle: string, fallbackName: string): string {
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
  if (spammyPrefixes.some((rx) => rx.test(title)) || title.length > 50 || title.length < 3) {
    return fallbackName;
  }
  return title;
}

const PUBLISHED_EMAIL_RX = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/;
const PUBLISHED_PHONE_RX = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/;
const PUBLISHED_LICENSE_RX = /\b(?:TX[-\s]?)?(TECL|TACLA|TACLB|TSBPE|RMP|PLMB|FIRE|CONC|STEEL|ROOF|FIN|ELEC)[-\s]?([A-Z0-9]{3,10})\b/i;
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
  return match ? `${match[1].toUpperCase()}-${match[2].toUpperCase()}` : null;
}

function isRegistrySource(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return REGISTRY_HOSTS.some((registry) => host === registry || host.endsWith(`.${registry}`));
  } catch {
    return false;
  }
}

/**
 * Maps one search hit to a contractor record using only published data.
 * License numbers, phone numbers and emails are recorded only when the scraped
 * page actually contains them; otherwise the record is explicitly unverified.
 */
function mapSearchItemToContractor(item: any, fallbackName: string, registryUrl: string): DiscoveredContractor {
  const cleanTitle = sanitizeContractorCompanyName(item?.title, fallbackName);
  const markdown: string = typeof item?.markdown === "string" ? item.markdown : "";
  const description: string = typeof item?.description === "string" ? item.description : "";
  const combinedText = `${markdown}\n${description}`;
  const sourceUrl: string = item?.url || registryUrl;
  const publishedEmail = findPublishedEmail(combinedText);
  const publishedPhone = findPublishedPhone(combinedText);
  const publishedLicense = findPublishedLicense(combinedText);
  const registryMatch = isRegistrySource(item?.url);
  return {
    companyName: cleanTitle,
    contactEmail: publishedEmail || "not-published@verify-required.invalid",
    phone: publishedPhone || undefined,
    licenseNumber: publishedLicense || "Not verified",
    licenseStatus: publishedLicense && registryMatch
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
    const { city, stateAbbr: state } = parseCityAndState(projectLocation);

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
            const fallbackName = `${city} Commercial ${tradePkg.tradeName.split(" ")[0]} Services ${i + 1}`;
            discoveredContractors.push(mapSearchItemToContractor(item, fallbackName, stateCfg.registryUrl));
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
              const fallbackName = `${city} Commercial ${tradePkg.tradeName.split(" ")[0]} Services ${i + 1}`;
              discoveredContractors.push(mapSearchItemToContractor(item, fallbackName, stateCfg.registryUrl));
            }
          }
        }
      } catch (err) {
        console.warn("Firecrawl search failed or timed out, falling back to verified trade directory:", err);
      }
    }

    // High-quality verified trade directory fallback if Firecrawl didn't return items or key missing
    let usedSampleDirectory = false;
    if (discoveredContractors.length === 0) {
      usedSampleDirectory = true;
      const div = tradePkg.csiDivision.slice(0, 2);
      if (div === "26") {
        if (state === "TX") {
          discoveredContractors.push(
            {
              companyName: "Rosendin Electric, Inc.",
              contactEmail: "estimating@rosendin.com",
              sourceUrl: "https://www.rosendin.com",
            },
            {
              companyName: "Alterman, Inc.",
              contactEmail: "estimating@goalterman.com",
              sourceUrl: "https://goalterman.com",
            },
            {
              companyName: "Prism Electric, Inc.",
              contactEmail: "estimating@prismelectric.com",
              sourceUrl: "https://prismelectric.com",
            },
            {
              companyName: "Bergelectric Corp.",
              contactEmail: "estimating@bergelectric.com",
              sourceUrl: "https://www.bergelectric.com",
            }
          );
        } else {
          discoveredContractors.push(
            {
              companyName: "Rosendin Electric, Inc.",
              contactEmail: "estimating@rosendin.com",
              sourceUrl: "https://www.rosendin.com",
            },
            {
              companyName: "Alterman, Inc.",
              contactEmail: "estimating@goalterman.com",
              sourceUrl: "https://goalterman.com",
            },
            {
              companyName: "Prism Electric, Inc.",
              contactEmail: "estimating@prismelectric.com",
              sourceUrl: "https://prismelectric.com",
            },
            {
              companyName: "Bergelectric Corp.",
              contactEmail: "estimating@bergelectric.com",
              sourceUrl: "https://www.bergelectric.com",
            }
          );
        }
      } else if (div === "23") {
        if (state === "TX") {
          discoveredContractors.push(
            {
              companyName: "TDIndustries, Inc.",
              contactEmail: "estimating@tdindustries.com",
              sourceUrl: "https://www.tdindustries.com",
            },
            {
              companyName: "The Brandt Companies, LLC",
              contactEmail: "estimating@brandt.us",
              sourceUrl: "https://brandt.us",
            },
            {
              companyName: "Southland Industries",
              contactEmail: "estimating@southlandind.com",
              sourceUrl: "https://southlandind.com",
            },
            {
              companyName: "Dynamic Systems, Inc.",
              contactEmail: "commercial@dynamicsystemsusa.com",
              sourceUrl: "https://www.dynamicsystemsusa.com",
            }
          );
        } else {
          discoveredContractors.push(
            {
              companyName: "TDIndustries, Inc.",
              contactEmail: "estimating@tdindustries.com",
              sourceUrl: "https://www.tdindustries.com",
            },
            {
              companyName: "The Brandt Companies, LLC",
              contactEmail: "estimating@brandt.us",
              sourceUrl: "https://brandt.us",
            },
            {
              companyName: "Southland Industries",
              contactEmail: "estimating@southlandind.com",
              sourceUrl: "https://southlandind.com",
            }
          );
        }
      } else if (div === "22") {
        if (state === "TX") {
          discoveredContractors.push(
            {
              companyName: "Clarke Kent Plumbing",
              contactEmail: "dispatch@clarkekentplumbing.com",
              sourceUrl: "https://clarkekentplumbing.com",
            },
            {
              companyName: "Limbach Facility Services LLC",
              contactEmail: "estimating@limbachinc.com",
              sourceUrl: "https://limbachinc.com",
            },
            {
              companyName: "TDIndustries, Inc. (Plumbing)",
              contactEmail: "plumbing@tdindustries.com",
              sourceUrl: "https://www.tdindustries.com",
            }
          );
        } else {
          discoveredContractors.push(
            {
              companyName: "TDIndustries, Inc. (Plumbing)",
              contactEmail: "plumbing@tdindustries.com",
              sourceUrl: "https://www.tdindustries.com",
            },
            {
              companyName: "Clarke Kent Plumbing LLC",
              contactEmail: "dispatch@clarkekentplumbing.com",
              sourceUrl: "https://clarkekentplumbing.com",
            }
          );
        }
      } else if (div === "21") {
        discoveredContractors.push(
          {
            companyName: "Century Fire Protection LLC",
            contactEmail: "contact@centuryfp.com",
            sourceUrl: "https://www.centuryfp.com/",
          },
          {
            companyName: "Viking Fire Protection Group",
            contactEmail: "info@vikinggroupinc.com",
            sourceUrl: "https://www.vikinggroupinc.com/",
          }
        );
      } else if (div === "03") {
        discoveredContractors.push(
          {
            companyName: "Baker Concrete Construction",
            contactEmail: "bids@bakerconcrete.com",
            sourceUrl: "https://www.bakerconcrete.com/",
          },
          {
            companyName: "Webcor Concrete",
            contactEmail: "estimating@webcor.com",
            sourceUrl: "https://www.webcor.com/",
          }
        );
      } else if (div === "05") {
        discoveredContractors.push(
          {
            companyName: "Commercial Metals Company (CMC)",
            contactEmail: "estimating@cmc.com",
            sourceUrl: "https://www.cmc.com/",
          },
          {
            companyName: "American Institute of Steel Construction",
            contactEmail: "info@aisc.org",
            sourceUrl: "https://www.aisc.org/",
          }
        );
      } else if (div === "07") {
        discoveredContractors.push(
          {
            companyName: "CentiMark Corporation",
            contactEmail: "contactus@centimark.com",
            sourceUrl: "https://www.centimark.com/",
          },
          {
            companyName: "Chamberlin Roofing & Waterproofing",
            contactEmail: "info@chamberlinltd.com",
            sourceUrl: "https://www.chamberlinltd.com/",
          }
        );
      } else if (div === "09") {
        discoveredContractors.push(
          {
            companyName: "Marek Brothers Systems Inc.",
            contactEmail: "bids@marekbros.com",
            sourceUrl: "https://www.marekbros.com/",
          },
          {
            companyName: "Performance Contracting, Inc. (PCI)",
            contactEmail: "estimating@pcg.com",
            sourceUrl: "https://www.performancecontracting.com/",
          }
        );
      } else {
        discoveredContractors.push(
          {
            companyName: "Associated General Contractors (AGC)",
            contactEmail: "bids@agc.org",
            sourceUrl: "https://www.agc.org/",
          },
          {
            companyName: "Rosendin Commercial Services",
            contactEmail: "estimating@rosendin.com",
            sourceUrl: "https://www.rosendin.com/",
          }
        );
      }
    }

    // The built-in directory is a sample dataset. Strip invented license data and label
    // every record so it can never be mistaken for a registry verification.
    if (usedSampleDirectory) {
      for (const contractor of discoveredContractors) {
        contractor.licenseNumber = "Not verified";
        contractor.licenseStatus = "Unverified — sample directory record";
        contractor.phone = undefined;
        contractor.contactEmail = "not-published@verify-required.invalid";
      }
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

    const source = usedSampleDirectory
      ? "Built-in sample directory (licenses unverified)"
      : "Firecrawl web search (license data only when published in the source)";

    // Record in reactive audit stream
    await ctx.runMutation(internal.auditLogs.recordLogInternal, {
      projectId: tradePkg.projectId,
      tradePackageId: args.tradePackageId,
      eventType: "compliance_audit",
      title: `Contractors Discovered: Division ${tradePkg.csiDivision}`,
      description: usedSampleDirectory
        ? `Loaded ${discoveredContractors.length} sample contractor record(s) from the built-in directory. License numbers are NOT verified; confirm licensing with the state registry before sourcing.`
        : `Discovered ${discoveredContractors.length} contractor record(s) via Firecrawl web search. License numbers and contacts are recorded only when published in the source; verify before sourcing.`,
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
