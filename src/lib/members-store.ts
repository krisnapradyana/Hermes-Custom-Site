import { promises as fs } from "fs";
import path from "path";

/**
 * Member Directory — the studio's role/capability database (alpha).
 * One JSON file in DATA_DIR, seeded from the managers' capability directory
 * on first access. Editable only by leadership types (see canEditDirectory);
 * Hermes links Slack ids later via the internal endpoint.
 * "best_used_for" was dropped from the schema by decision (over-engineered
 * for the UI) — it lives on in the agent-facing knowledge instead.
 */

export interface Member {
  id: string;
  name: string;
  type: string;
  primaryRole: string;
  secondaryRoles: string[];
  capabilities: string[];
  trajectory?: string;
  employment?: string;
  location?: string;
  slackId?: string;
  createdAt: string;
  updatedAt: string;
}

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "members.json");

/** Types allowed to view/edit the directory (case-insensitive, and
 * "Creative Technology" counts as Creative Technologist). */
export function canEditDirectory(type: string | undefined): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  return (
    t.includes("core leadership") ||
    t.includes("creative leadership") ||
    t.includes("production leadership") ||
    t.includes("creative technolog")
  );
}

const now = () => new Date().toISOString();
const uid = () => `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Initial database — imported from SPX_TEAM_CAPABILITY_DIRECTORY. */
const SEED: Omit<Member, "id" | "createdAt" | "updatedAt">[] = [
  { name: "Kelvin Wira", type: "Core Leadership", primaryRole: "Founder / CEO", secondaryRoles: ["Business Development", "Company Vision", "Strategic Direction"], capabilities: ["Business strategy", "Client and opportunity development", "High-level decision making", "Company vision", "Strategic partnerships"] },
  { name: "Puput", type: "Core Leadership", primaryRole: "General Manager / Indonesia Studio & Operations Lead", secondaryRoles: ["Organization Development", "People & Talent Management", "Operations", "Culture Development", "Business Development Indonesia", "Vision Translator"], capabilities: ["Translating company vision into execution", "Organization design", "Talent and people strategy", "Studio operations", "Cross-functional coordination", "Production understanding", "Culture building", "Strategic planning", "Building new business models"] },
  { name: "Calita", type: "Production Leadership", primaryRole: "Producer", trajectory: "Senior Producer / Executive Producer", secondaryRoles: [], capabilities: ["Project management", "Client communication", "Internal stakeholder communication", "Production planning", "Framework and workflow design", "Risk management", "Resource coordination", "Producer mentoring", "Structured problem solving"] },
  { name: "Natalie Valentine (V)", type: "Production", primaryRole: "Producer / Project Manager", secondaryRoles: ["Client Relationship"], capabilities: ["Project coordination", "Client communication", "Stakeholder management", "Social and client-facing communication", "Recurring production management", "Relationship building"] },
  { name: "Eli", type: "Creative Leadership", primaryRole: "Senior Art Director", trajectory: "Creative Director", secondaryRoles: [], capabilities: ["Creative direction", "Art direction", "Creative quality control", "Visual judgment", "Creative problem solving", "Structured creative communication", "Creative mentoring", "Hands-on visual execution", "Studio creative standards"] },
  { name: "Raffael", type: "Creative Leadership", primaryRole: "Creative Lead / 2D Generalist Artist", trajectory: "Art Director", secondaryRoles: [], capabilities: ["2D animation", "Visual development", "Storytelling", "Illustration", "Creative direction", "Project leadership", "Workflow design", "Team supervision", "Creative mentoring"] },
  { name: "Lenny", type: "Creative", primaryRole: "Junior Art Director / 2D Motion Graphic Artist", secondaryRoles: [], capabilities: ["2D motion graphics", "Project creative coordination", "Creative supervision", "Production workflow understanding", "Fast contextual learning", "Bread-and-butter creative leadership"] },
  { name: "Disa", type: "Creative Specialist", primaryRole: "Illustrator / Concept Artist", secondaryRoles: ["Visual Development", "Co-Creative Lead"], capabilities: ["Illustration", "Concept art", "Visual development", "Pre-production", "Style exploration", "Key visual development", "Creative quality review", "Artist supervision"] },
  { name: "Ryan", type: "Senior Creative Specialist", primaryRole: "2D Motion Graphic Artist", secondaryRoles: ["Project Lead", "Illustrator", "Storyboard Artist", "Styleframe Artist", "Mentor"], capabilities: ["2D motion", "Animation", "Illustration", "Storyboarding", "Styleframes", "Familiar project leadership", "Junior mentoring", "Independent creative work"] },
  { name: "Lauren", type: "Creative / Singapore Operations", primaryRole: "Art Director / Motion Designer / Generalist Artist", secondaryRoles: ["Singapore Client & Production Bridge", "Onsite Creative Support"], capabilities: ["Art direction", "2D motion", "3D motion", "Generalist visual production", "Client meetings", "Onsite production", "Rehearsal support", "Singapore-side coordination"] },
  { name: "Aldo", type: "Senior Production / Creative Technology", primaryRole: "Production Solutions Lead", secondaryRoles: ["Motion Designer", "Compositor", "2D/3D Generalist", "Production R&D"], capabilities: ["Cross-disciplinary production problem solving", "2D motion", "3D production", "Compositing", "Workflow design", "Production R&D", "Technical feasibility", "Production troubleshooting", "New production techniques"] },
  { name: "Doni", type: "Senior 3D", primaryRole: "Senior 3D Generalist / 3D Production Designer", secondaryRoles: ["Technical Mentor", "3D Production Lead"], capabilities: ["3D production", "Production design", "Technical problem solving", "3D workflow", "Technical exploration", "Alternative production solutions", "Junior and intern mentoring", "Experiential production support"] },
  { name: "Ratna", type: "Senior 3D Specialist", primaryRole: "3D Generalist Artist / 3D R&D Artist", secondaryRoles: [], capabilities: ["3D technical exploration", "3D R&D", "Look development", "Visual experimentation", "Deep technical problem solving", "Creative 3D exploration", "Technical coordination when required"] },
  { name: "Kenley", type: "3D Specialist", primaryRole: "3D Generalist Artist", secondaryRoles: [], capabilities: ["3D production", "Technical exploration", "Structured production work", "Technical execution", "Context-based problem solving"] },
  { name: "Kevin", type: "Emerging Creative Leadership", primaryRole: "Junior Art Director", secondaryRoles: ["New Media / Experiential Creative", "3D / Motion Generalist"], capabilities: ["New media", "Experiential creative", "Projection mapping", "Immersive production exploration", "3D and motion", "Creative leadership", "Team collaboration", "Industry research", "Talent and vendor ecosystem research"] },
  { name: "Aurel", type: "High-Potential Craft Specialist", primaryRole: "2D Motion Designer / Compositor", secondaryRoles: [], capabilities: ["2D motion", "Compositing", "Motion finishing", "Technical problem solving", "Independent execution", "Counter-proposing solutions", "Adding craft value beyond the brief"] },
  { name: "Krisna", type: "Creative Technology", primaryRole: "Creative Technologist / Programmer", secondaryRoles: [], capabilities: ["Programming", "Creative technology", "Interactive development", "Prototyping", "Technical R&D", "Creative-tech brainstorming", "Translating creative ideas into technical solutions", "Understanding SPX production culture"] },
  { name: "Ivan", type: "Marketing / Creative Operations", primaryRole: "Marketing Visual Designer / Marketing Coordinator", secondaryRoles: [], capabilities: ["Marketing visual design", "Creative production support", "Research", "Reference-based visual development", "Marketing coordination", "Practical problem solving", "Cross-functional support"] },
  { name: "Alma", type: "Marketing / Content", primaryRole: "SEO Specialist / Content Writer / Copywriter", secondaryRoles: [], capabilities: ["SEO", "Content writing", "Copywriting", "Website content", "Research", "Content optimization", "Structured writing", "AI-assisted writing workflows"] },
  { name: "Mark", type: "External Strategic Partner", employment: "Freelance", location: "Singapore", primaryRole: "Freelance Creative Director / Project Maker", secondaryRoles: ["Broadcast Industry Specialist", "Sports Broadcast Specialist", "Singapore Client Representative", "Business Opportunity Connector"], capabilities: ["20+ years broadcast industry experience", "Sports broadcast", "Motion design", "Creative direction", "Singapore client meetings", "Industry networking", "Business opportunity development", "Senior client-facing representation"] },
];

async function writeAtomic(members: Member[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(members, null, 2));
  await fs.rename(tmp, FILE);
}

export async function readMembers(): Promise<Member[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf-8")) as Member[];
  } catch {
    // First run: seed from the capability directory.
    const seeded = SEED.map((m) => ({ ...m, id: uid(), createdAt: now(), updatedAt: now() }));
    await writeAtomic(seeded);
    return seeded;
  }
}

export async function findBySlackId(slackId: string): Promise<Member | undefined> {
  return (await readMembers()).find((m) => m.slackId === slackId);
}

export async function createMember(
  data: Pick<Member, "name" | "type" | "primaryRole"> & Partial<Member>
): Promise<Member> {
  const members = await readMembers();
  const member: Member = {
    id: uid(),
    name: data.name.trim(),
    type: data.type.trim(),
    primaryRole: data.primaryRole.trim(),
    secondaryRoles: data.secondaryRoles ?? [],
    capabilities: data.capabilities ?? [],
    trajectory: data.trajectory?.trim() || undefined,
    employment: data.employment?.trim() || undefined,
    location: data.location?.trim() || undefined,
    slackId: data.slackId?.trim() || undefined,
    createdAt: now(),
    updatedAt: now(),
  };
  await writeAtomic([...members, member]);
  return member;
}

export async function updateMember(
  id: string,
  patch: Partial<Omit<Member, "id" | "createdAt">>
): Promise<Member | null> {
  const members = await readMembers();
  const idx = members.findIndex((m) => m.id === id);
  if (idx === -1) return null;
  const next: Member = {
    ...members[idx],
    ...patch,
    name: (patch.name ?? members[idx].name).trim(),
    type: (patch.type ?? members[idx].type).trim(),
    primaryRole: (patch.primaryRole ?? members[idx].primaryRole).trim(),
    slackId: patch.slackId !== undefined ? patch.slackId.trim() || undefined : members[idx].slackId,
    id: members[idx].id,
    createdAt: members[idx].createdAt,
    updatedAt: now(),
  };
  members[idx] = next;
  await writeAtomic(members);
  return next;
}

export async function deleteMember(id: string): Promise<void> {
  const members = await readMembers();
  await writeAtomic(members.filter((m) => m.id !== id));
}
