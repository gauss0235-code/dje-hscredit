/* 공동교육과정 만족도 조사 기준표(10문항 + 서술형) — 새 설문을 만들 때 기본으로 들어가는 문항 */
window.JCS_DEFAULT_QUESTIONS = [
  { id: "q1", type: "likert", section: "수업 계획 및 내용", required: true,
    text: "수업 내용, 운영 일정, 평가 방법 및 성적 처리 계획 등이 명확하게 안내되었다." },
  { id: "q2", type: "likert", section: "수업 계획 및 내용", required: true,
    text: "수업 내용은 과목의 성격과 목표에 부합하였다." },
  { id: "q3", type: "likert", section: "교수·학습 활동", required: true,
    text: "선생님은 수업 내용을 잘 이해할 수 있도록 적절한 설명과 필요한 자료를 제공하였다." },
  { id: "q4", type: "likert", section: "교수·학습 활동", required: true,
    text: "수업은 자유롭게 질문하고 의견을 나눌 수 있도록 운영되었다." },
  { id: "q5", type: "likert", section: "교수·학습 활동", required: true,
    text: "정해진 시작·종료 시각에 맞추어 수업이 진행되었다." },
  { id: "q6", type: "likert", section: "운영", required: true,
    text: "수업 환경(장소, 시간대, 기자재, 수강 인원 등)은 참여하기에 적절하였다." },
  { id: "q7", type: "likert", section: "운영", required: true,
    text: "출결 관련 안내, 등·하교 안전 사고 예방 교육, 학교 폭력 예방 교육이 적절하게 이루어졌다." },
  { id: "q8", type: "likert", section: "기타", required: true,
    text: "소속 학교에서 개설되지 않은 과목을 수강할 수 있어 과목 선택의 폭이 넓어졌다." },
  { id: "q9", type: "likert", section: "기타", required: true,
    text: "수업이 진로와 적성을 탐색하고 진학을 준비하는 데 도움이 되었다." },
  { id: "q10", type: "likert", section: "기타", required: true,
    text: "관심 있는 친구들에게 이 수업을 권하고 싶을 만큼 만족스러웠다." },
  // 기준표대로 좋았던 점과 개선할 점을 한 문항으로 받음 (2026-10-22, 필수). 둘을 나누는 일은 AI 분석이 함
  { id: "opinion", type: "text", section: "서술형", required: true, textRole: "other", maxLength: 1000,
    text: "수업에 관해 좋았던 점과 개선해야 할 점을 자유롭게 적어 주세요.",
    placeholder: "예) 실험 활동이 많아 내용을 이해하기 쉬웠어요. 다만 수업이 늦게 끝나 귀가가 늦었어요." }
];
