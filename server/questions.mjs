export const questions = [
  {
    id: 1,
    prompt: 'Nombre completo',
    suggestedPrice: '0.10',
    fields: [
      {
        key: 'fullName',
        label: 'Nombre completo',
        type: 'text',
        placeholder: 'Nombre completo',
      },
    ],
  },
  {
    id: 4,
    prompt: 'Fecha de nacimiento',
    suggestedPrice: '0.10',
    fields: [
      {
        key: 'birthDate',
        label: 'Fecha de nacimiento',
        type: 'date',
        placeholder: 'Fecha de nacimiento',
      },
    ],
  },
  {
    id: 2,
    prompt: 'Número de contacto',
    suggestedPrice: '0.10',
    fields: [
      {
        key: 'contactNumber',
        label: 'Número de contacto',
        type: 'tel',
        placeholder: 'Número de contacto',
      },
    ],
  },
  {
    id: 3,
    prompt: 'Ciudad y barrio de residencia',
    suggestedPrice: '0.10',
    fields: [
      {
        key: 'city',
        label: 'Ciudad',
        type: 'text',
        placeholder: 'Ciudad',
      },
      {
        key: 'neighborhood',
        label: 'Barrio',
        type: 'text',
        placeholder: 'Barrio',
      },
    ],
  },
]

export const getQuestion = (id) =>
  questions.find((question) => question.id === Number(id))
