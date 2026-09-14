import os
import shutil
import urllib.request

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

DOWNLOAD_TARGETS = [
    {
        "name": "01_00_00_General_Requirements.pdf",
        "url": "https://nibs-s3-wbdg3-production.s3.us-east-1.amazonaws.com:443/FFC/DOD/UFC/ufc_1_200_02_2020_c3.pdf",
        "subDirs": ["", "specs"],
        "description": "Unified Facilities Criteria 1-200-02: Building Requirements & Master Specification Standard",
    },
    {
        "name": "26_00_00_Electrical_Systems_Spec.pdf",
        "url": "https://nibs-s3-wbdg3-production.s3.us-east-1.amazonaws.com:443/FFC/DOD/UFC/ufc_3_540_07_2018_c1.pdf",
        "subDirs": ["", "specs"],
        "description": "Unified Facilities Criteria 3-540-07: Electrical Power Systems, Generators & Main Switchgear",
    },
    {
        "name": "23_00_00_HVAC_Systems_Spec.pdf",
        "url": "https://nibs-s3-wbdg3-production.s3.us-east-1.amazonaws.com:443/FFC/DOD/UFGS/UFGS%2023%2005%2093.pdf",
        "subDirs": ["", "specs"],
        "description": "Unified Facilities Guide Specifications 23 05 93: Testing, Adjusting, and Balancing for HVAC",
    },
    {
        "name": "22_00_00_Plumbing_Systems_Spec.pdf",
        "url": "https://nibs-s3-wbdg3-production.s3.us-east-1.amazonaws.com:443/FFC/DOD/UFC/ufc_3_230_02_2019_c2.pdf",
        "subDirs": ["", "specs"],
        "description": "Unified Facilities Criteria 3-230-02: Water Supply, Distribution & Commercial Plumbing Systems",
    },
    {
        "name": "Rosendin_Electric_ACORD25_COI.pdf",
        "url": "https://raw.githubusercontent.com/markwalters2/acord-filler/master/acord-25-blank.pdf",
        "subDirs": ["", "insurance"],
        "description": "ACORD 25 Certificate of Liability Insurance standard commercial form",
        "aliases": ["Lone_Star_Electric_ACORD25_COI.pdf"],
    },
    {
        "name": "E-101_Main_Switchgear_Penthouse_Plan.pdf",
        "url": "https://archive.org/download/fe_Construction_Drawings_for_12PU350_and_12PU500_Windmills/Construction_Drawings_for_12PU350_and_12PU500_Windmills.pdf",
        "subDirs": ["", "drawings"],
        "description": "Authentic Public Construction Drawing & Blueprint Set",
    },
    {
        "name": "Rosendin_Electric_Proposal_AIA.pdf",
        "url": "https://archive.org/download/CIA-RDP89B00709R000200410018-3/CIA-RDP89B00709R000200410018-3.pdf",
        "subDirs": ["", "quotes"],
        "description": "Authentic Subcontract Proposal with Prime Contractor & Cost Breakdown",
        "aliases": ["Lone_Star_Electric_Proposal_AIA.pdf"],
    },
    {
        "name": "Alterman_Power_Quote_Proposal.pdf",
        "url": "https://archive.org/download/manualzilla-id-5641335/5641335.pdf",
        "subDirs": ["", "quotes"],
        "description": "Authentic Commercial Price Bid Proposal for Equipment & Systems",
        "aliases": ["Austin_Metro_Power_Quote_Proposal.pdf"],
    },
]

def download_file(url, target_path):
    print(f"Downloading {url} -> {target_path}...")
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()
    with open(target_path, "wb") as f:
        f.write(data)
    print(f"  Successfully wrote {len(data)} bytes ({len(data)/1024:.1f} KB)")
    return len(data)

def main():
    print("=== Downloading Real Web Construction Documents ===")
    total_downloaded = 0
    for target in DOWNLOAD_TARGETS:
        fn = target["name"]
        url = target["url"]
        temp_dest = os.path.join(PUBLIC_DIR, f"temp_{fn}")
        size = download_file(url, temp_dest)
        total_downloaded += size

        # Distribute to appropriate subdirectories
        for sdir in target["subDirs"]:
            dest_dir = os.path.join(PUBLIC_DIR, sdir) if sdir else PUBLIC_DIR
            os.makedirs(dest_dir, exist_ok=True)
            final_path = os.path.join(dest_dir, fn)
            shutil.copyfile(temp_dest, final_path)
            print(f"  Installed -> {final_path}")
            for alias in target.get("aliases", []):
                alias_path = os.path.join(dest_dir, alias)
                shutil.copyfile(temp_dest, alias_path)
                print(f"  Installed alias -> {alias_path}")

        if os.path.exists(temp_dest):
            os.remove(temp_dest)

    print(f"\nAll downloads completed! Total: {total_downloaded/1024/1024:.2f} MB")

if __name__ == "__main__":
    main()
