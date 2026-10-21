/* =====================================================================
 *  학생 설문 화면 설정
 *  만족도 조사 관리 화면(admin.djhs-curriculum.kro.kr/survey/)과 같은 Supabase 프로젝트를 씁니다.
 *  (publishable 키는 공개용이라 웹페이지에 넣어도 됩니다. service_role 키는 절대 넣지 마세요.)
 * ===================================================================== */
window.JCS_CONFIG = {
  SUPABASE_URL: "https://nzsgvjdotnvqpzhehfsg.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_ALakaYU4jTYEIQas_nWrsQ_An3IK9_h",

  // 이 학생 설문 페이지의 주소 (QR코드에 들어가는 주소)
  SURVEY_BASE_URL: "https://djhs-curriculum.kro.kr/survey/",

  // AI 서술형 분석 Edge Function 이름 (학생 화면에서는 쓰지 않음)
  AI_FUNCTION_NAME: "jcs-ai-summary",

  // 화면에 표시되는 사업명
  PROGRAM_NAME: "너두나두 공동교육과정",
  ORG_NAME: "대전광역시교육청"
};
