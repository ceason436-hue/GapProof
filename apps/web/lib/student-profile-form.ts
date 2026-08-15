import type { StudentProfileView } from "@gapproof/contracts";

export type StudentProfileForm = {
  grade: "7" | "8" | "9" | "";
  subject: "english" | "";
  term: "first_term" | "second_term" | "";
  region: "shanghai" | "";
  learningState: "starting" | "catching_up" | "steady" | "";
};

/** Do not invent an initial learning range: empty values require a student choice. */
export function profileSetupInitialValues(profile: StudentProfileView): StudentProfileForm {
  return {
    grade: profile.grade ?? "",
    subject: profile.subject ?? "",
    term: profile.term ?? "",
    region: profile.region ?? "",
    learningState: profile.learningState ?? "",
  };
}

export function isCompleteProfileForm(form: StudentProfileForm): form is Exclude<StudentProfileForm, { grade: "" }> {
  return Object.values(form).every((value) => value !== "");
}
