export function archiveMemberSatisfies(member, requirement) {
  if (requirement.endsWith('/')) return member.startsWith(requirement);
  if (requirement.startsWith('.')) return member.endsWith(requirement);
  return member === requirement || member.endsWith(`/${requirement}`);
}
