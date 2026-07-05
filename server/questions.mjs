const prompts = [
  'Mi autobiografía',
  'Yo en 3 años',
  'Yo en 5 años',
  'Yo en 10 años',
  'Mis fantasias sociales',
  'Mis fantasias espirituales',
  'Mis fantasias profesionales',
  'Mis fantasias economicas',
  'Mis fantasias romanticas',
  'Mis fantasias sexuales',
  'Mis fetiches',
  'Mi infancia',
  'Mi adolescencia',
  'Mi adultez',
  'Mi primera cita',
  'Mi última cita',
  'Mi mejor cita',
  'Mi peor cita',
  'Mi peor error',
  'Mi acierto',
  'Mi fracaso',
  'Mi logro',
  'Mi arrepentimiento',
  'Mis viajes',
  'Mis empleos',
  'Mis aventuras',
  'Mis fiestas',
  'Mis pérdidas',
  'Mis desafíos',
  'Mis mudanzas',
  'Mis miedos',
  'Mis deseos',
  'Mis principios económicos',
  'Mis principios sexuales',
  'Mis principios sociales',
  'Mis principios emocionales',
  'Mis límites económicos',
  'Mis límites sexuales',
  'Mis límites sociales',
  'Mis límites emocionales',
  'Mi decisión más difícil',
  'Mi decisión de la que más orgulloso estoy',
  'Mi renuncia',
  'Mi sacrificio',
  'Mi mayor cambio',
  'Mi punto de quiebre',
  'Mi pareja',
  'Mis parejas',
  'Mis exparejas',
  'Mi expareja que más extraño',
  'Mi amante',
  'Mi enemigo',
  'Mi rival',
  'Mi crush',
  'Mi admirador',
  'Mi amor imposible',
  'Mi confidente',
  'Mi cómplice',
  'Mi persona favorita',
  'Mi terapeuta',
  'Mi mamá',
  'Mi papá',
  'Mis hijos',
  'Mis hijas',
  'Mis hermanos',
  'Mis hermanas',
  'Mis abuelos',
  'Mis abuelas',
  'Mis tíos',
  'Mis tías',
  'Mis primos',
  'Mis primas',
  'Mi suegro',
  'Mi suegra',
  'Mis cuñados',
  'Mis cuñadas',
  'Mi mejor amigo',
  'Mi mejor amiga',
  'Mis amigos',
  'Mis amigas',
  'Mis vecinos',
  'Mis vecinas',
  'Mi jefe',
  'Mi líder',
  'Mis socios',
  'Mis socias',
  'Mis empleados',
  'Mis empleadas',
  'Mis clientes',
  'Mis clientas',
  'Mis compañeros de trabajo',
  'Mis compañeras de trabajo',
  'Mis profesores',
  'Mis profesoras',
  'Mis alumnos',
  'Mis alumnas',
  'Mis mentores',
  'Mis mentoras',
  'Mi sexualidad',
  'Mi dinero',
  'Mi fidelidad',
  'Mi familia',
  'Mi trabajo',
  'Mi salud',
  'Mi cuerpo',
  'Mi mente',
  'Mi rutina',
  'Mi deporte',
  'Mi arte',
  'Mi talento',
  'Mi vicio',
  'Mi debilidad',
  'Mi fortaleza',
  'Mi yo deseado',
  'Mi cuerpo deseado',
  'Mi mente deseada',
  'Mi vida deseada',
  'Mi propósito',
  'Mi proyecto de vida',
  'Mi futuro',
  'Mi legado',
  'Mi relación con la ciencia',
  'Mi relación con la historia',
  'Mi relación con la educación',
  'Mi relación con la medicina',
  'Mi relación con la tecnología',
  'Mi relación con la economía',
  'Mi relación con la política',
  'Mi relación con la religión',
  'Mi relación con la geografía',
  'Mi relación con la filosofía',
  'Mi relación con la psicología',
  'Mi relación con el derecho',
  'Mi relación con las finanzas',
  'Mi relación con el emprendimiento',
  'Mi relación con el liderazgo',
  'Mi relación con la comunicación',
  'Mi relación con el arte',
  'Mi relación con la música',
  'Mi relación con el deporte',
  'Mi relación con la gastronomía',
  'Mi relación con la agricultura',
  'Mi relación con el medio ambiente',
  'Mi relación con los idiomas',
  'Mi relación con la programación',
  'Mi relación con la inteligencia artificial',
  'Mi relación con las inversiones',
  'Mi mejor consejo',
  'Mi prototipo físico de pareja',
  'Mi prototipo de personalidad de pareja',
  'Mi comida',
  'Mi música',
  'Mi película',
  'Mi serie',
  'Mi libro',
  'Mi color',
  'Mi estilo',
  'Mi hogar',
  'Mi ciudad',
  'Mi casa',
  'Mi habitación',
  'Mi mascota',
  'Mi proyecto',
  'Mi comunidad',
  'Mi invento',
  'Mi Dios',
  'Mi Diablo',
  'Mi bien',
  'Mi mal',
  'Mi creencia',
  'Mi religión',
  'Mi política',
  'Mi ángel',
  'Mi demonio',
  'Mi pecado',
  'Mis ídolos',
]

const fields = [
  {
    key: 'revelation',
    label: 'Redacción personal',
    type: 'textarea',
    placeholder: 'Escribe tu revelación personal sobre esta tarjeta',
  },
]

const getWritingExample = (prompt) => {
  const topic = prompt.toLocaleLowerCase('es-CO')

  if (/yo en \d+ años/.test(topic)) {
    return `Ejemplo: En ${topic.replace('yo en ', '')} me imagino en una etapa más clara de mi vida. Me veo tomando decisiones con más calma, cuidando mejor mis relaciones y construyendo algo que hoy todavía estoy empezando. También contaría qué temores tengo sobre ese futuro y qué estoy haciendo desde ahora para acercarme a esa versión de mí.`
  }

  if (topic.includes('fantasias')) {
    return `Ejemplo: Cuando pienso en ${topic}, no lo veo solo como un deseo secreto, sino como una parte de mí que muestra lo que anhelo, lo que me falta o lo que me atrevo a imaginar. Contaría cuándo apareció esa fantasía, qué emoción me produce y qué dice sobre mis límites, mis curiosidades y mi forma de ver la vida.`
  }

  if (/infancia|adolescencia|adultez/.test(topic)) {
    return `Ejemplo: Mi ${topic.replace('mi ', '')} estuvo marcada por momentos que todavía explican mucho de mi forma de ser. Recuerdo personas, lugares y decisiones que me hicieron sentir protegido, confundido o solo. Escribiría qué aprendí en esa etapa y qué parte de esa versión de mí todavía sigue presente.`
  }

  if (topic.includes('cita')) {
    return `Ejemplo: En ${topic} hubo detalles que todavía recuerdo con claridad: la expectativa antes de llegar, la manera en que fluyó o se rompió la conversación y lo que sentí al volver a casa. Contaría qué me mostró esa experiencia sobre mi forma de conectar, elegir y leer a otra persona.`
  }

  if (/error|acierto|fracaso|logro|arrepentimiento|decisión|renuncia|sacrificio|cambio|quiebre/.test(topic)) {
    return `Ejemplo: ${prompt} fue una experiencia que no se entiende solo por el resultado. Contaría qué estaba viviendo en ese momento, por qué actué como actué y qué consecuencias tuvo para mí. También explicaría qué aprendí, qué repetiría, qué no volvería a hacer y cómo eso cambió mi manera de decidir.`
  }

  if (/viajes|empleos|aventuras|fiestas|pérdidas|desafíos|mudanzas/.test(topic)) {
    return `Ejemplo: ${prompt} reúne recuerdos que muestran cómo me muevo por el mundo. Hablaría de una experiencia concreta, de las personas que estuvieron ahí y de lo que descubrí sobre mí en ese contexto. Más que contar hechos, intentaría explicar qué cambió en mi carácter después de vivirlo.`
  }

  if (topic.includes('principios')) {
    return `Ejemplo: En ${topic} hablaría de las reglas internas que intento respetar incluso cuando nadie me está mirando. Contaría de dónde vienen esos principios, cuándo los he puesto a prueba y qué cosas no estoy dispuesto a negociar porque definen mi manera de vivir.`
  }

  if (topic.includes('límites')) {
    return `Ejemplo: En ${topic} explicaría qué cosas acepto, cuáles me incomodan y cuáles definitivamente no cruzo. También contaría cómo aprendí esos límites, si alguna vez permití que alguien los pasara y qué hago hoy para cuidarme sin dejar de relacionarme con otros.`
  }

  if (/pareja|parejas|expareja|amante|crush|admirador|amor imposible|fidelidad/.test(topic)) {
    return `Ejemplo: En ${topic} contaría una historia que muestre cómo amo, cómo deseo y cómo me vinculo. Hablaría de lo que me atrae, de lo que me cuesta, de mis heridas y de las cosas que necesito para sentir confianza. También diría qué aprendí de esa persona o de esa etapa.`
  }

  if (/enemigo|rival|confidente|cómplice|persona favorita|terapeuta/.test(topic)) {
    return `Ejemplo: ${prompt} revela una relación que tuvo un papel importante en mi vida. Contaría quién fue esa persona para mí, qué despertó en mi carácter y qué aprendí de esa cercanía, distancia o tensión. También explicaría por qué todavía la recuerdo de esa manera.`
  }

  if (/mamá|papá|hijos|hijas|hermanos|hermanas|abuelos|abuelas|tíos|tías|primos|primas|suegro|suegra|cuñados|cuñadas|familia/.test(topic)) {
    return `Ejemplo: En ${topic} hablaría de una relación familiar con sus luces y sus sombras. Contaría qué recibí, qué me faltó, qué heridas o gratitudes guardo y cómo esa historia influyó en mi forma de amar, confiar, protegerme o tomar distancia.`
  }

  if (/amigo|amiga|amigos|amigas|vecinos|vecinas/.test(topic)) {
    return `Ejemplo: En ${topic} contaría qué tipo de compañía he buscado y qué clase de persona soy cuando tengo confianza. Hablaría de lealtad, momentos compartidos, decepciones y aprendizajes sobre la amistad, la convivencia y la forma en que dejo entrar a otros en mi vida.`
  }

  if (/jefe|líder|socios|socias|empleados|empleadas|clientes|clientas|compañeros|compañeras|profesores|profesoras|alumnos|alumnas|mentores|mentoras/.test(topic)) {
    return `Ejemplo: ${prompt} muestra cómo me relaciono en espacios de trabajo, aprendizaje o responsabilidad. Contaría una experiencia concreta, qué rol ocupé, qué conflictos o admiraciones aparecieron y qué dice eso sobre mi carácter, mi disciplina y mi manera de colaborar.`
  }

  if (/sexualidad|dinero|trabajo|salud|cuerpo|mente|rutina|deporte|arte|talento|vicio|debilidad|fortaleza/.test(topic)) {
    return `Ejemplo: En ${topic} escribiría con honestidad sobre cómo vivo esa parte de mí. Contaría qué me cuesta, qué cuido, qué he descubierto y qué contradicciones tengo. También diría cómo esa dimensión afecta mis decisiones, mis relaciones y la imagen que otros suelen hacerse de mí.`
  }

  if (/deseado|deseada|propósito|proyecto de vida|futuro|legado/.test(topic)) {
    return `Ejemplo: ${prompt} habla de la persona que quiero llegar a ser. Describiría esa visión sin maquillarla demasiado: qué deseo construir, qué hábitos necesito cambiar, qué miedo me acompaña y qué señal me haría sentir que voy por el camino correcto.`
  }

  if (topic.includes('mi relación con')) {
    return `Ejemplo: En ${topic} contaría cómo se formó mi postura frente a ese tema. Hablaría de experiencias, influencias, dudas y cambios de opinión. También explicaría si esa relación es de curiosidad, rechazo, respeto, pasión o conflicto, y cómo afecta mi forma de ver el mundo.`
  }

  if (/consejo|prototipo/.test(topic)) {
    return `Ejemplo: ${prompt} no sería una lista fría; explicaría de dónde nació esa idea y qué experiencias la sostienen. Contaría qué busco, qué evito y qué he aprendido después de equivocarme o mirar de cerca lo que realmente funciona para mí.`
  }

  if (/comida|música|película|serie|libro|color|estilo/.test(topic)) {
    return `Ejemplo: En ${topic} hablaría de algo que parece simple, pero revela mi sensibilidad. Contaría cuándo empezó ese gusto, qué recuerdos despierta, con quién lo comparto y por qué siento que dice algo verdadero sobre mi personalidad.`
  }

  if (/hogar|ciudad|casa|habitación|mascota|proyecto|comunidad|invento/.test(topic)) {
    return `Ejemplo: ${prompt} muestra el tipo de entorno, pertenencia o creación que me importa. Describiría un recuerdo o una imagen concreta, lo que me hace sentir y por qué ese lugar, vínculo o idea representa una parte importante de mi identidad.`
  }

  if (/dios|diablo|bien|mal|creencia|religión|política|ángel|demonio|pecado|ídolos/.test(topic)) {
    return `Ejemplo: En ${topic} escribiría sobre mis creencias sin intentar convencer a nadie. Contaría qué experiencias formaron esa postura, qué dudas todavía tengo y cómo esa visión influye en mis decisiones, mis culpas, mis admiraciones y mi manera de juzgarme.`
  }

  return `Ejemplo: En ${topic} contaría una escena concreta de mi vida, cómo me hizo sentir y qué aprendí de eso. También explicaría qué revela de mí hoy, qué cambió con el tiempo y qué quisiera que otra persona entendiera antes de acercarse a mí.`
}

const createQuestion = (prompt, index) => ({
  id: index + 1,
  key: `Revelación:${prompt}`,
  category: 'Revelación',
  prompt,
  suggestedPrice: '0.10',
  writingExample: getWritingExample(prompt),
  minWords: 100,
  maxWords: 2000,
  maxCharacters: 12000,
  fields,
})

export const questions = prompts.map(createQuestion)

export const getQuestion = (id) =>
  questions.find((question) => question.id === Number(id))
