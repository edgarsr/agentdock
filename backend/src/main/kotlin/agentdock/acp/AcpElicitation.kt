@file:OptIn(com.agentclientprotocol.annotations.UnstableApi::class)

package agentdock.acp

import com.agentclientprotocol.model.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import java.net.URI
import java.time.LocalDate
import java.time.OffsetDateTime
import java.util.UUID

@Serializable
internal data class ElicitationRequestPayload(
    val requestId: String,
    val chatId: String,
    val agentName: String,
    val message: String,
    val requestedSchema: ElicitationSchema,
    val toolCallId: String? = null
)

@Serializable
internal data class ElicitationResponsePayload(
    val requestId: String,
    val chatId: String,
    val elicitationId: String,
    val action: String,
    val content: JsonObject? = null
)

internal class PendingElicitation(
    val request: ElicitationRequestPayload,
    val response: CompletableDeferred<CreateElicitationResponse> = CompletableDeferred()
)

internal fun AcpClientService.pendingElicitationRequests(chatId: String): List<ElicitationRequestPayload> {
    val pending = sessions[chatId]?.pendingElicitations ?: return emptyList()
    return synchronized(pending) { pending.values.map { it.request } }
}

internal suspend fun AcpClientService.createElicitation(
    sessionId: String,
    request: CreateElicitationRequest
): CreateElicitationResponse {
    val form = request.mode as? ElicitationMode.Form
        ?: return CreateElicitationResponse(ElicitationAction.Cancel)
    val context = synchronized(liveOwnerBySessionId) {
        liveOwnerBySessionId[sessionId]?.let(sessions::get)
    } ?: return CreateElicitationResponse(ElicitationAction.Cancel)
    val adapterId = context.activeAdapterNameRef.get().orEmpty()
    val pending = PendingElicitation(
        ElicitationRequestPayload(
            requestId = UUID.randomUUID().toString(),
            chatId = context.chatId,
            agentName = runCatching { AcpAdapterConfig.getAdapterInfo(adapterId).name }.getOrDefault(adapterId),
            message = request.message,
            requestedSchema = form.requestedSchema,
            toolCallId = (request.scope as? ElicitationScope.Session)?.toolCallId?.value
        )
    )
    synchronized(context.pendingElicitations) {
        if (context.sessionIdRef.get() != sessionId || context.session == null || context.ignoreUpdatesUntilPrompt) {
            return CreateElicitationResponse(ElicitationAction.Cancel)
        }
        context.pendingElicitations[pending.request.requestId] = pending
    }
    try {
        // Keep waiting while the page reconnects; attachChat restores the backend's pending forms.
        elicitationRequestsChangedHandler?.invoke(context.chatId, true)
        return pending.response.await()
    } finally {
        val removed = synchronized(context.pendingElicitations) {
            context.pendingElicitations.remove(pending.request.requestId) != null
        }
        if (removed) elicitationRequestsChangedHandler?.invoke(context.chatId, false)
    }
}

internal fun AcpClientService.respondToElicitation(
    payload: ElicitationResponsePayload,
    onAccepted: (ElicitationRequestPayload, JsonObject) -> Unit
): String? {
    val context = sessions[payload.chatId] ?: return "This question is no longer pending."
    val error = synchronized(context.pendingElicitations) {
        val pending = context.pendingElicitations[payload.elicitationId]
            ?: return@synchronized "This question is no longer pending."
        val content = payload.content ?: JsonObject(emptyMap())
        val action = when (payload.action) {
            "accept" -> {
                validateElicitationContent(pending.request.requestedSchema, content)?.let { return@synchronized it }
                Json.decodeFromJsonElement<ElicitationAction.Accept>(buildJsonObject { put("content", content) })
            }
            "decline" -> ElicitationAction.Decline
            "cancel" -> ElicitationAction.Cancel
            else -> return@synchronized "Invalid question response."
        }
        // Record the reply before completing the request, so subsequent agent output follows it.
        if (payload.action == "accept") onAccepted(pending.request, content)
        context.pendingElicitations.remove(payload.elicitationId)
        pending.response.complete(CreateElicitationResponse(action))
        null
    }
    if (error == null) elicitationRequestsChangedHandler?.invoke(payload.chatId, false)
    return error
}

/**
 * Pairs each answer with its question. A free-text field right after a choice is that choice's own answer, as the
 * form shows it, so its text joins the choice's answer instead of appearing under the field's input hint.
 */
internal fun buildElicitationAnswerEvent(request: ElicitationRequestPayload, content: JsonObject): JsonObject {
    val entries = mutableListOf<Pair<String, MutableList<String>>>()
    var previousHasOptions = false
    for ((key, field) in request.requestedSchema.properties) {
        val options = field.enumOptions()
        val texts = content[key]?.let { answerTexts(it, options) }.orEmpty()
        if (previousHasOptions && options == null && field is ElicitationPropertySchema.StringProperty) {
            entries.last().second += texts
        } else {
            entries += (field.description ?: field.title ?: key) to texts.toMutableList()
        }
        previousHasOptions = options != null
    }
    val answers = entries.filter { it.second.isNotEmpty() }.map { (question, texts) ->
        buildJsonObject {
            put("question", question)
            put("answer", texts.joinToString(", "))
        }
    }
    val text = answers.joinToString("\n\n") {
        "${it.getValue("question").jsonPrimitive.content}\n${it.getValue("answer").jsonPrimitive.content}"
    }.ifEmpty { request.message }
    return JsonObject(buildStoredContentChunk("assistant", "elicitation_answer", text = text) + ("answers" to JsonArray(answers)))
}

private val ElicitationPropertySchema.title: String?
    get() = when (this) {
        is ElicitationPropertySchema.StringProperty -> title
        is ElicitationPropertySchema.NumberProperty -> title
        is ElicitationPropertySchema.IntegerProperty -> title
        is ElicitationPropertySchema.BooleanProperty -> title
        is ElicitationPropertySchema.ArrayProperty -> title
    }?.takeIf { it.isNotBlank() }

private val ElicitationPropertySchema.description: String?
    get() = when (this) {
        is ElicitationPropertySchema.StringProperty -> description
        is ElicitationPropertySchema.NumberProperty -> description
        is ElicitationPropertySchema.IntegerProperty -> description
        is ElicitationPropertySchema.BooleanProperty -> description
        is ElicitationPropertySchema.ArrayProperty -> description
    }?.takeIf { it.isNotBlank() }

/** The choices of a single or multi select, or null for a field the user types or toggles. */
private fun ElicitationPropertySchema.enumOptions(): List<EnumOption>? = when (this) {
    is ElicitationPropertySchema.StringProperty -> oneOf ?: enumValues?.map { EnumOption(it, it) }
    is ElicitationPropertySchema.ArrayProperty -> when (val items = items) {
        is MultiSelectItems.Untitled -> items.items.values.map { EnumOption(it, it) }
        is MultiSelectItems.Titled -> items.items.options
    }
    else -> null
}

private fun answerTexts(value: JsonElement, options: List<EnumOption>?): List<String> {
    fun label(item: JsonPrimitive) = options?.firstOrNull { it.value == item.content }?.title ?: item.content
    return when {
        value is JsonArray -> value.map { label(it.jsonPrimitive) }
        value is JsonPrimitive && !value.isString && value.booleanOrNull != null -> listOf(if (value.boolean) "Yes" else "No")
        else -> listOf(label(value.jsonPrimitive)).filter { it.isNotBlank() }
    }
}

/** Validates only ACP's flat form schema; answers never become a new user prompt. */
internal fun validateElicitationContent(schema: ElicitationSchema, content: JsonObject): String? {
    if (content.keys.any { it !in schema.properties }) return "The answer contains an unknown field."
    for ((key, field) in schema.properties) {
        // A blank text is no answer, so a required field cannot be sent empty.
        val value = content[key]?.takeUnless { it is JsonPrimitive && it.isString && it.content.isBlank() }
        val title = field.title ?: key
        if (value == null) {
            if (key in schema.required.orEmpty()) return "$title is required."
            continue
        }
        val valid = when (field) {
            is ElicitationPropertySchema.StringProperty -> {
                val text = (value as? JsonPrimitive)?.takeIf { it.isString }?.content
                text != null && text.codePointCount(0, text.length).let { length ->
                    (field.minLength == null || length >= field.minLength!!) &&
                        (field.maxLength == null || length <= field.maxLength!!)
                } && (field.enumValues == null || text in field.enumValues!!) &&
                    (field.oneOf == null || field.oneOf!!.any { it.value == text }) &&
                    (field.pattern == null || runCatching { Regex(field.pattern!!).containsMatchIn(text) }.getOrDefault(false)) &&
                    validElicitationFormat(text, field.format)
            }
            is ElicitationPropertySchema.NumberProperty -> elicitationNumber(value)?.let { number ->
                (field.minimum == null || number >= field.minimum!!) && (field.maximum == null || number <= field.maximum!!)
            } ?: false
            is ElicitationPropertySchema.IntegerProperty -> elicitationNumber(value)?.let { number ->
                number % 1.0 == 0.0 && (field.minimum == null || number >= field.minimum!!.toDouble()) &&
                    (field.maximum == null || number <= field.maximum!!.toDouble())
            } ?: false
            is ElicitationPropertySchema.BooleanProperty ->
                (value as? JsonPrimitive)?.let { !it.isString && it.booleanOrNull != null } == true
            is ElicitationPropertySchema.ArrayProperty -> {
                val values = value as? JsonArray
                val options = when (val items = field.items) {
                    is MultiSelectItems.Untitled -> items.items.values
                    is MultiSelectItems.Titled -> items.items.options.map { it.value }
                }
                values != null && (field.minItems == null || values.size >= field.minItems!!) &&
                    (field.maxItems == null || values.size <= field.maxItems!!) && values.all {
                        it is JsonPrimitive && it.isString && it.content in options
                    } && values.distinct().size == values.size
            }
        }
        if (!valid) return "Check the answer for $title."
    }
    return null
}

private fun elicitationNumber(value: JsonElement): Double? =
    (value as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull?.takeIf { it.isFinite() }

private fun validElicitationFormat(value: String, format: StringFormat?): Boolean = when (format) {
    null -> true
    StringFormat.EMAIL -> Regex("^[^\\s@]+@[^\\s@]+$").matches(value)
    StringFormat.URI -> runCatching { URI(value).isAbsolute }.getOrDefault(false)
    StringFormat.DATE -> runCatching { LocalDate.parse(value) }.isSuccess
    StringFormat.DATE_TIME -> runCatching { OffsetDateTime.parse(value) }.isSuccess
}
