document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector<HTMLFormElement>('[data-filter-form]');
  if (!form) return;

  const selects = form.querySelectorAll<HTMLSelectElement>('select');
  selects.forEach(select => {
    select.addEventListener('change', () => form.submit());
  });
});
