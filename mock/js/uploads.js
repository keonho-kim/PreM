// Purpose: Validate mock file metadata without reading file contents.
// Pattern: Narrow browser boundary shared by project and Space upload commands.
// Usage: Composed before dialogs and forms in app.js.
// Related: mock/js/forms.js, mock/js/space.js, mock/js/dialogs.js.
window.PreMModules.uploads = (capabilities) => {
  'use strict';
  const { $, uid } = capabilities;
  function validateFiles(form, extensions = ['pdf', 'hwp', 'hwpx', 'docx', 'pptx', 'xlsx']) {
    const input = $('input[type="file"]', form);
    const files = [...(input?.files ?? [])];
    let error = '';
    if (files.length > 10) error = '파일은 한 번에 10개까지 선택해 주세요.';
    else if (files.some((file) => !extensions.includes(file.name.split('.').at(-1).toLowerCase())))
      error = '지원하는 형식의 문서를 선택해 주세요.';
    else if (files.some((file) => file.size > 50 * 1024 * 1024))
      error = '목업에서는 파일당 50 MiB 이하로 선택해 주세요.';
    else if (files.some((file) => file.size === 0)) error = '빈 파일은 선택할 수 없습니다.';
    input?.setCustomValidity(error);
    if (error) {
      input.reportValidity();
      return null;
    }
    return files;
  }
  const metadata = (files) =>
    files.map((file) => ({
      id: uid(),
      name: file.name,
      extension: file.name.split('.').at(-1).toLowerCase(),
      size: file.size,
      pages: null,
      status: 'registered',
      sample: false,
      at: new Date().toISOString(),
    }));
  return { validateFiles, metadata };
};
