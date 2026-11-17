// Purpose: Supply deterministic native object proposals for the real browser workflow.
// Pattern: Uses only images supplied by the server and explicit synthetic chart values.
// Usage: outline-fixture.cjs delegates object-scope edits here.
// Related: presentation-objects.cjs, backend/tests/outline_support/edit.rs.
module.exports = function objectChanges(context) {
  const box = (x, y, width, height) => ({ x, y, width, height, rotation: 0 });
  const selected = context.selected_object_ids ?? [];
  const objects = selected.length
    ? context.current_slide.objects
        .filter((o) => selected.includes(o.id))
        .map((o) => ({ ...o, frame: { ...o.frame, x: 50 } }))
    : [
        {
          id: 'chart-1',
          name: '분기 실적',
          frame: box(55, 20, 40, 35),
          content: {
            kind: 'chart',
            chart_type: 'column',
            title: '실적',
            categories: ['A', 'B'],
            series: [{ name: '건수', values: [10, 20] }],
          },
        },
        {
          id: 'shape-1',
          name: '강조 도형',
          frame: box(55, 85, 35, 5),
          content: { kind: 'shape', shape: 'rectangle', fill: '#F58254' },
        },
        ...(context.available_images?.length
          ? [
              {
                id: 'image-1',
                name: '등록 이미지',
                frame: box(55, 60, 30, 20),
                content: { kind: 'image', media_id: context.available_images[0].id },
              },
            ]
          : []),
      ];
  return { objects, layout: { title: box(5, 10, 90, 15), body: box(5, 30, 40, 60) } };
};
