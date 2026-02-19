I need you to write a markdown parser. It will go in the src/parsers/markdown/ folder and be named capabilityParser.ts.

Go ahead and write tests for the parser as well. I expect there to be reasonable coverage.

It parses a markdown file with a very specific format. That format is the following:

You can assume you won't run into any html comments but I left some to add info as needed. If you do run into one, throw an error saying they are not allowed.

```md
# [Title](https://dora.dev/capabilities/title/)

One or more paragraphs for the introduction.

This could be a second paragraph.

## Nuances

Nuances introduction. 1-3 paragraphs.

This could be a second paragraph.

### My First Nuance with Some Interesting Title

1-2 paragraphs. There could be up to 10 of these. They will need to be parsed into an array.

This could be a second paragraph.

### My Second Nuance with Some Interesting Title

1-2 paragraphs.

This could be a second paragraph.

## Assessment

Few short paragraphs introducing the assesment

1. First Title: Brief sentence about the content.
2. Second Title: Brief sentence about the content.
3. Third Title: Brief sentence about the content.
4. Fourth Title: Brief sentence about the content.

Few short paragraphs with more info about them.

## Supporting Practices

More introduction paragraphs before a list of markdown H3's with paragraphs. There could be any number of items. It will probably be around 2-8.

### Supporting Practice One

A few paragraphs. Note this one's title does not have a link. That is okay.

### [Supporting Practice Two](/practices/supporting-practice-two.md)

More of the same on those paragraphs.

## Adjacent Capabilities

The following capabilities will be valuable for you and your team to explore, as they are either: <!-- this comment will not be in the text, This introduction will alwayst be exactly the same. Verify it is correct in the parsing -->

- Related (they cover similar territory to Job Satisfaction) <!-- These will also be exactly the same -->
- Upstream (they are a pre-requisite for Job Satisfaction)
- Downstream (Job Satisfaction is a pre-requisite for them)

### [Capability 1](/capabilities/capability-1.md) - Upstream

More of the same when it comes to paragraphs.

### [Capability 2](/capabilities/capability-2.md) - Downstream

More of the same when it comes to paragraphs.

### [Capability 3](/capabilities/capability-3.md) - Related

More of the same when it comes to paragraphs.
```

After parsing this file, I would expect some json like the following:

```json
{
    "title": "Title",
    "doraLink": "https://dora.dev/capabilities/title/",
    "introduction": "One or more paragraphs for the introduction.\nThis could be a second paragraph.", // notice there is only one \n where the original document has 2. This is a common theme.
    "nuances": {
        "introduction": "One or more paragraphs for the introduction.\nThis could be a second paragraph.",
        "items": [
            {
                "title": "My First Nuance with Some Interesting Title",
                "content": "1-2 paragraphs. There could be up to 10 of these. They will need to be parsed into an array.\nThis could be a second paragraph."
            },
            {
                "title": "My Second Nuance with Some Interesting Title",
                "content": "1-2 paragraphs.\nThis could be a second paragraph."
            },
        ]
    },
    "assessment": {
        "intro": "Few short paragraphs introducing the assesment",
        "outro": "Few short paragraphs with more info about them.",
        "ratings": [
            {
                "rating": 1,
                "title:": "First Title",
                "description": "Brief sentence about the content."
            },
            {
                "rating": 2,
                "title:": "Second Title",
                "description": "Brief sentence about the content."
            },
            {
                "rating": 3,
                "title:": "Third Title",
                "description": "Brief sentence about the content."
            },
            {
                "rating": 4,
                "title:":"Fourth Title",
                "description": "Brief sentence about the content."
            }
        ]
    },
    "supporting_practices": {
        "intro": "More introduction paragraphs before a list of markdown H3's with paragraphs. There could be any number of items. It will probably be around 2-8."
        "practices": [
            {
                "id": null,
                "title": "Supporting Practice one",
                "description": "A few paragraphs. Note this one's title does not have a link. That is okay."
            },
            {
                "id":"supporting-practice-two",
                "title": "Supporting Practice Two",
                "description": "More of the same on those paragraphs."

            },
        ]
    },
    "linked_capabilities": [
        {
            "id": "capability-1",
            "title": "Capability 1",
            "relationship": "upstream",
            "description": "More of the same when it comes to paragraphs.\nMore of the same when it comes to paragraphs."
        },
        {
            "id": "capability-2",
            "title": "Capability 2",
            "relationship": "downstream",
            "description": "More of the same when it comes to paragraphs."
        },
        {
            "id": "capability-3",
            "title": "Capability 3",
            "relationship": "related",
            "description": "More of the same when it comes to paragraphs."
        }
    ]
}
```

If you run into any issues parsing, throw a descriptive error that will help me determine where in the file it has bad formatting. Think something like a linting error.
