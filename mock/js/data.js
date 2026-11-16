// Purpose: Own the clearly labeled sample documents, guides, templates, and decks.
// Pattern: Feature factory with an explicit application context.
// Usage: Registered before mock/app.js by mock/index.html.
// Related: mock/app.js, mock/index.html.
window.PuPuTyXModules.data = (context) => {
  'use strict';
  const { clone, uid } = context;
  const guideFields = [
    ['do', '이렇게 만들어 주세요'],
    ['dont', '이것은 피해주세요'],
  ];

  const navigation = [
    ['overview', '개요', 'LayoutDashboard'],
    ['documents', '원본 문서', 'Files'],
    ['guide', '작성 방향', 'BookOpen'],
    ['outline', '목차 정리', 'ListTree'],
    ['references', '참고 자료', 'Library'],
    ['templates', '템플릿', 'PanelsTopLeft'],
    ['presentations', 'PPT 생성과 편집', 'Presentation'],
    ['history', '작업 이력', 'History'],
  ];

  const blocks = [
    {
      id: 'b1',
      title: '이번 분기 주요 성과',
      page: 2,
      text: '이번 분기에는 고객 문의 응대와 팀 간 자료 공유 방식을 개선했습니다. 주요 성과와 남은 과제를 함께 정리합니다.',
    },
    {
      id: 'b2',
      title: '고객 의견과 개선 과제',
      page: 4,
      text: '고객 의견을 살펴보니 안내 자료를 찾기 어렵다는 의견이 있었습니다. 자주 묻는 질문을 정리하고 담당자 안내를 보완합니다.',
    },
    {
      id: 'b3',
      title: '다음 분기 실행 계획',
      page: 6,
      text: '다음 분기에는 안내 자료를 정비하고 부서별 진행 상황을 월간 회의에서 공유합니다. 필요한 지원 사항과 담당 일정을 함께 확인합니다.',
    },
    {
      id: 'b4',
      title: '팀 간 협업 방식',
      page: 8,
      text: '각 팀의 진행 상황을 같은 양식으로 모읍니다. 검토 의견은 다음 회의 전까지 반영하고 최종 발표 자료를 함께 확인합니다.',
    },
    {
      id: 'b5',
      title: '회의 안건과 결정 사항',
      page: 10,
      text: '회의에서는 주요 성과, 개선 과제, 다음 분기 일정을 순서대로 살펴봅니다. 결정이 필요한 사항은 담당 부서와 확인 날짜를 함께 남깁니다.',
    },
  ];

  const templateLibrary = [
    {
      id: 'standard',
      name: 'PuPuTyX 기본',
      kind: 'Brand / Deck',
      note: '흰 문서 표면과 선명한 핵심 메시지',
      theme: '',
      layouts: ['표지', '목차', '본문', '비교', '프로세스', '마무리'],
    },
    {
      id: 'briefing',
      name: 'Briefing 브리핑',
      kind: 'Style / Deck',
      note: '차분한 로즈 표면의 발표 자료',
      theme: 'briefing',
      layouts: ['표지', '핵심 메시지', '본문', '마무리'],
    },
    {
      id: 'editorial',
      name: 'Editorial 리포트',
      kind: 'Layout / Deck',
      note: '문장과 표를 중심으로 정리한 구성',
      theme: 'editorial',
      layouts: ['표지', '두 단', '표', '근거', '마무리'],
    },
  ];

  const referenceLibrary = [
    {
      id: 'r1',
      title: '분기 보고 자료 작성 안내',
      tag: '업무 안내',
      page: 4,
      quote:
        '보고 자료에는 주요 성과와 개선 과제를 함께 정리합니다. 수치와 인용문은 출처를 확인하고 발표 전에 담당자의 검토를 받습니다.',
      source: '샘플 공용 자료',
      version: 2,
    },
    {
      id: 'r2',
      title: '사내 발표 자료 작성 원칙',
      tag: '내용',
      page: 3,
      quote:
        '핵심 메시지를 먼저 제시하고, 각 슬라이드의 주장에 연결된 원문 근거를 함께 검토합니다.',
      source: '샘플 공용 자료',
      version: 1,
    },
    {
      id: 'r3',
      title: '회사 디자인 템플릿 사용 안내',
      tag: '디자인',
      page: 6,
      quote:
        '템플릿의 브랜드와 레이아웃 규칙을 구분하고, 내용의 구조에 적합한 레이아웃을 선택합니다.',
      source: '샘플 공용 자료',
      version: 1,
    },
  ];

  function makeSlides(title, count = 6, nodes = null) {
    const source = nodes ?? [
      '분기 업무 보고',
      '이번 분기 주요 성과',
      '고객 의견과 개선 과제',
      '다음 분기 실행 계획',
      '팀 간 협업 방식',
      '회의 안건과 결정 사항',
    ];
    return Array.from({ length: count }, (_, index) => ({
      id: uid(),
      version: 1,
      title: index === 0 ? title : source[index % source.length],
      layout: index === 0 ? 'cover' : index % 3 === 2 ? 'process' : 'content',
      body:
        index === 0
          ? ['주요 성과와 다음 분기 계획을 공유합니다.']
          : index % 3 === 2
            ? ['현황 확인', '개선 과제', '다음 분기 실행']
            : [
                blocks[index % blocks.length].text,
                '주요 내용과 출처를 함께 확인합니다.',
                '결정이 필요한 사항을 중심으로 논의합니다.',
              ],
      evidence: [blocks[index % blocks.length].id],
    }));
  }

  function newProject(id, name, documents = [], endDate = null) {
    const guide = {
      version: 1,
      at: new Date().toISOString(),
      do: '핵심 근거를 먼저 보여주고, 한 장에 메시지 하나를 담아 주세요.',
      dont: '근거 없는 주장과 과도한 장식은 피해주세요.',
      goal: '주요 성과와 다음 분기 계획을 알기 쉽게 소개합니다.',
      audience: '팀원과 부서장',
      emphasis: '주요 성과, 개선 과제, 다음 일정',
      required: '업무 현황과 다음 분기 계획',
      avoid: '확인되지 않은 수치와 근거 없는 주장',
      storyline: '성과 → 개선 과제 → 다음 계획',
      references: '회사 공용 가이드와 프로젝트 원본 문서',
      visual: '내용에 맞는 간결한 프로세스와 비교 구성',
      free: '',
    };
    return {
      id,
      name,
      status: 'active',
      endDate,
      documents,
      guides: [guide],
      outlines: blocks.map((block, index) => ({
        id: 'o' + (index + 1),
        title: block.title,
        blockIds: [block.id],
      })),
      outlineVersion: 1,
      selectedRefs: ['r1', 'r2'],
      template: 'standard',
      decks: [],
      history: [],
    };
  }

  function seed() {
    const now = Date.now();
    const p = newProject('platform', '분기 업무 보고', [
      {
        id: 'doc1',
        name: '분기 실적 보고서.pdf',
        extension: 'pdf',
        size: 2400000,
        pages: 12,
        status: 'completed',
        sample: true,
        at: new Date(now - 3600000).toISOString(),
      },
      {
        id: 'doc2',
        name: '회의 메모.docx',
        extension: 'docx',
        size: 640000,
        pages: 8,
        status: 'completed',
        sample: true,
        at: new Date(now - 5400000).toISOString(),
      },
      {
        id: 'doc3',
        name: '참고 프레젠테이션.pptx',
        extension: 'pptx',
        size: 4200000,
        pages: 6,
        status: 'registered',
        sample: true,
        at: new Date(now - 7200000).toISOString(),
      },
    ]);
    p.guides[0].at = new Date(now - 2 * 3600000).toISOString();
    p.guides.push({
      ...p.guides[0],
      version: 2,
      emphasis: '주요 성과와 다음 분기 실행 계획',
      at: new Date(now - 1200000).toISOString(),
    });
    const slides = makeSlides('이번 분기를 돌아보고\n다음 계획을 세웁니다');
    p.decks.push({
      id: 'deck1',
      title: '분기 업무 보고 자료',
      guideVersion: 1,
      outlineVersion: 1,
      template: 'standard',
      version: 1,
      slides,
      revisions: [{ version: 1, at: new Date(now - 2400000).toISOString(), slides: clone(slides) }],
    });
    p.history = [
      {
        id: 'h1',
        title: '작성 방향 v2 저장',
        description: '기존 목차와 PPT는 유지',
        status: 'completed',
        at: new Date(now - 1200000).toISOString(),
      },
      {
        id: 'h2',
        title: '프레젠테이션 샘플 구성',
        description: '가이드 v1을 적용한 6개 슬라이드',
        status: 'completed',
        at: new Date(now - 2400000).toISOString(),
      },
      {
        id: 'h3',
        title: '보고 자료 준비',
        description: '목차별 내용 정리',
        status: 'completed',
        at: new Date(now - 3600000).toISOString(),
      },
    ];
    const p2 = newProject('knowledge', '신입사원 온보딩 안내');
    const p3 = newProject('workshop', '팀 워크숍 준비');
    p3.status = 'archived';
    const dates = window.PuPuTyXModules.projectDates;
    p.endDate = dates.shift(14);
    p2.endDate = dates.shift(7);
    p3.endDate = dates.shift(-3);
    return {
      projects: [p, p2, p3],
      providers: [],
      routes: {},
      runs: [],
      session: { role: 'admin' },
      spaceAssets: [],
    };
  }
  return {
    guideFields,
    navigation,
    blocks,
    templateLibrary,
    referenceLibrary,
    makeSlides,
    newProject,
    seed,
  };
};
