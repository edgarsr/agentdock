plugins {
    id("org.jetbrains.kotlin.jvm") version "2.2.20"
    id("org.jetbrains.kotlin.plugin.serialization") version "2.2.20"
    id("org.jetbrains.intellij.platform") version "2.10.5"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2024.3.1")
        jetbrainsRuntime()
    }
    implementation("com.agentclientprotocol:acp:0.14.1")
}

kotlin {
    jvmToolchain(21)
}

intellijPlatform {
    pluginConfiguration {
        version = providers.gradleProperty("pluginVersion")
        name = "Unified LLM Agents"
        description = "Unified LLM AI Agents plugin."
        vendor {
            name = "E"
        }
    }
}

tasks {
    buildSearchableOptions {
        enabled = false
    }

    val npm = if (org.gradle.internal.os.OperatingSystem.current().isWindows) "npm.cmd" else "npm"

    val npmBuild by registering(Exec::class) {
        workingDir = file("frontend")
        commandLine(npm, "run", "build")
    }

    processResources {
        dependsOn(npmBuild)
    }
}
