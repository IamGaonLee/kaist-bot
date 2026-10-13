// KLMS HTML 셀렉터 모음. KLMS가 개편되면 이 파일부터 고친다 (README "고장 났을 때" 참고).
export const SEL = {
  course: {
    // format_kaistweeks, course/view.php?id=X&section=0
    section: 'li.section.main[id^="section-"]',
    sectionName: 'h3.sectionname > span.sectionname',
    sectionDates: 'em',
    sectionSummary: 'div.summary',
    module: 'li.activity[id^="module-"]',
    moduleName: '.instancename',
    moduleNameHidden: '.accesshide', // 이름 뒤에 붙는 유형명(" 파일")
    moduleLink: 'a.aalink',
    moduleDownload: '.aalink[onclick*="downloadFile"]',
    moduleIcon: 'img.activityicon',
    moduleEndDt: 'strong.end-dt',
    moduleStatus: 'strong.status',
    labelContent: '.contentwithoutlink',
    userId: '[data-user-id]',
  },
  assign: {
    title: 'div[role="main"] > h2',
    intro: '#intro',
    introAttachments: 'a[href*="/mod_assign/introattachment/"]',
    statusRows: '.submissionstatustable table.generaltable tr',
  },
  board: {
    title: '.courseboard .h_main_title h3.main',
    rows: 'table.courseboard_table tbody tr',
    pageLinks: 'div.pagination li a[href*="page="]',
    activePage: 'div.pagination li.active',
    attachIcon: 'img[alt="attach"]',
  },
  article: {
    root: '.courseboard_view',
    subject: '.subject h3',
    writer: '.info .writer',
    date: '.info .date',
    body: '.content .text_to_html',
    bodyFallback: '.content',
    files: '.info .files a[href*="pluginfile.php"], .files a[href*="pluginfile.php"]',
  },
} as const;

/** 과제 페이지 상태 표의 행 이름 (한국어/영어 UI) */
export const ASSIGN_ROW = {
  submission: ['제출 상태', 'Submission status'],
  grading: ['채점 상태', 'Grading status'],
  due: ['마감 일시', 'Due date'],
  lastModified: ['마지막 수정', 'Last modified'],
} as const;

/** 게시판 종류: 과목 페이지 아이콘 파일명 */
export const BOARD_KIND_BY_ICON: Record<string, 'notice' | 'qna' | 'board'> = {
  icon_notice: 'notice',
  icon_qna: 'qna',
  icon_default: 'board',
};
